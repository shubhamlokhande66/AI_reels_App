import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { settings } from "@/server/core/config";
import { db } from "@/server/core/db";
import { forgetFiles, keepFile } from "@/server/storage/dbFiles";
import { localPath } from "@/server/storage/local";
import { getTask, TASKS } from "./types";

/** The AI configuration in effect (.env + what the person saved in Settings; was ai/ai_config.py, model_choice.py),
 * prices (pricing.py), and the usage log with budgets (usage.py). API keys are never saved or logged. */

export const PROVIDERS = ["ollama", "openai", "gemini", "claude"] as const;
export const LOCAL_PROVIDERS = new Set(["ollama"]);
const KEY = "settings/ai_config.json", MODEL_KEY = "settings/ai_model.json";

const readJson = (key: string) => { try { return JSON.parse(fs.readFileSync(localPath(key), "utf8")); } catch { return null; } };
const writeJson = (key: string, v: unknown) => { const f = localPath(key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); void keepFile(key); };

export function getChosenModel(): string | null {
  const name = readJson(MODEL_KEY)?.model;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
export function setChosenModel(model: string | null) {
  if (!model) { try { fs.rmSync(localPath(MODEL_KEY), { force: true }); } catch { /* nothing saved */ } void forgetFiles(MODEL_KEY); return; }
  writeJson(MODEL_KEY, { model: model.trim() });
}

const ProviderModels = z.object({ text: z.string().max(120).nullable().default(null), vision: z.string().max(120).nullable().default(null) });
export const SavedAIConfig = z.object({
  provider: z.string().nullable().default(null), textProvider: z.string().nullable().default(null), visionProvider: z.string().nullable().default(null),
  fallbackEnabled: z.boolean().nullable().default(null), fallbackProvider: z.string().nullable().default(null), models: z.record(z.string(), ProviderModels).default({}),
  taskProviders: z.record(z.string(), z.string()).default({}), dailyBudget: z.number().min(0).nullable().default(null), monthlyBudget: z.number().min(0).nullable().default(null),
  budgetOverride: z.boolean().default(false),
});
export type SavedAIConfig = z.infer<typeof SavedAIConfig>;

/** The saved file uses Python's snake_case keys; both spellings are read. */
export function loadSaved(): SavedAIConfig {
  const raw = readJson(KEY) ?? {};
  const camel = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
  try { return SavedAIConfig.parse(camel); } catch { console.warn("Could not read the saved AI settings; using the .env values."); return SavedAIConfig.parse({}); }
}
export function saveConfig(cfg: SavedAIConfig) {
  const snake = Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()), v]));
  writeJson(KEY, snake);
}

export interface EffectiveAIConfig {
  provider: string; textProvider: string; visionProvider: string; fallbackEnabled: boolean; fallbackProvider: string; models: Record<string, [string, string]>;
  taskProviders: Record<string, string>; dailyBudget: number; monthlyBudget: number; budgetOverride: boolean;
}
const norm = (n: string | null | undefined) => (n ?? "").trim().toLowerCase();

export function effective(saved: SavedAIConfig = loadSaved()): EffectiveAIConfig {
  const provider = norm(saved.provider) || norm(settings.aiProvider) || "ollama";
  const pick = (p: string, envText: string, envVision: string): [string, string] => {
    const m = saved.models[p] ?? { text: null, vision: null };
    const t = (m.text ?? "").trim() || envText.trim();
    return [t, (m.vision ?? "").trim() || envVision.trim() || t];
  };
  return {
    provider, textProvider: norm(saved.textProvider) || norm(settings.aiTextProvider) || provider, visionProvider: norm(saved.visionProvider) || norm(settings.aiVisionProvider) || provider,
    fallbackEnabled: saved.fallbackEnabled ?? settings.aiFallbackEnabled, fallbackProvider: norm(saved.fallbackProvider) || norm(settings.aiFallbackProvider),
    models: { ollama: pick("ollama", getChosenModel() || settings.ollamaModel, settings.ollamaVisionModel), openai: pick("openai", settings.openaiTextModel, settings.openaiVisionModel),
      gemini: pick("gemini", settings.geminiTextModel, settings.geminiVisionModel), claude: pick("claude", settings.claudeTextModel, settings.claudeVisionModel) },
    taskProviders: Object.fromEntries(Object.entries(saved.taskProviders).map(([k, v]) => [k, norm(v)]).filter(([k, v]) => k in TASKS && (PROVIDERS as readonly string[]).includes(v))), // a task the app no longer has is dropped
    dailyBudget: saved.dailyBudget ?? settings.dailyAiBudget, monthlyBudget: saved.monthlyBudget ?? settings.monthlyAiBudget, budgetOverride: saved.budgetOverride,
  };
}
export function providerFor(cfg: EffectiveAIConfig, task: string | null | undefined): string {
  const o = cfg.taskProviders[task ?? ""];
  if (o && (PROVIDERS as readonly string[]).includes(o)) return o;
  return getTask(task).kind === "vision" ? cfg.visionProvider : cfg.textProvider;
}
export function keyConfigured(p: string): boolean {
  if (p === "openai") return Boolean(settings.openaiApiKey.trim());
  if (p === "gemini") return Boolean(settings.geminiApiKey.trim());
  if (p === "claude") return Boolean(settings.anthropicApiKey.trim());
  return true;
}
const LABEL: Record<string, string> = { ollama: "Ollama", openai: "OpenAI", gemini: "Gemini", claude: "Claude" };
/** What the browser may see: choices and whether keys exist, never the keys. */
export const publicView = (cfg: EffectiveAIConfig) => ({
  provider: cfg.provider, textProvider: cfg.textProvider, visionProvider: cfg.visionProvider, fallbackEnabled: cfg.fallbackEnabled, fallbackProvider: cfg.fallbackProvider || null,
  taskProviders: cfg.taskProviders, providers: PROVIDERS.map((p) => ({ id: p, label: LABEL[p], local: LOCAL_PROVIDERS.has(p), keyConfigured: keyConfigured(p), textModel: cfg.models[p][0] || null, visionModel: cfg.models[p][1] || null })),
  dailyBudget: cfg.dailyBudget, monthlyBudget: cfg.monthlyBudget, budgetOverride: cfg.budgetOverride, currency: settings.aiCurrency,
});

// ------------------------------------------------------------------ prices (AI_MODEL_PRICES, USD per 1M tokens)
let priceCache: [string, Record<string, Record<string, number>>] | null = null;
function prices(): Record<string, Record<string, number>> {
  const raw = settings.aiModelPrices;
  if (priceCache && priceCache[0] === raw) return priceCache[1];
  let out: Record<string, Record<string, number>> = {};
  try {
    const data = raw.trim() ? JSON.parse(raw) : {};
    out = Object.fromEntries(Object.entries(data as Record<string, Record<string, unknown>>).filter(([, p]) => p && typeof p === "object")
      .map(([m, p]) => [m, Object.fromEntries(["input", "output", "cached"].filter((k) => k in p && Number.isFinite(Number(p[k]))).map((k) => [k, Number(p[k])]))]));
  } catch { console.warn("AI_MODEL_PRICES is not valid JSON; costs will show as not priced."); }
  priceCache = [raw, out];
  return out;
}
export function priceFor(model: string) {
  const table = prices();
  let best: string | null = null;
  for (const k of Object.keys(table)) if ((model === k || model.startsWith(k)) && (!best || k.length > best.length)) best = k;
  return best ? table[best] : null;
}
export function estimateCost(model: string, tin: number | null, tout: number | null, cachedIn: number | null = null): number | null {
  const p = priceFor(model);
  if (!p || (tin === null && tout === null)) return null;
  const cached = Math.min(cachedIn ?? 0, tin ?? 0), fresh = (tin ?? 0) - cached;
  return Math.round(((fresh * (p.input ?? 0) + cached * (p.cached ?? p.input ?? 0) + (tout ?? 0) * (p.output ?? 0)) / 1_000_000) * 1e6) / 1e6;
}
export const toDisplay = (usd: number | null) => (usd === null ? null : Math.round(usd * settings.aiCurrencyRate * 1e4) / 1e4);
export const fromDisplay = (amount: number) => (settings.aiCurrencyRate > 0 ? amount / settings.aiCurrencyRate : amount);

// ------------------------------------------------------------------ usage log and budget
const projectCtx = new AsyncLocalStorage<string | null>();
/** AI calls made inside `fn` are logged against the project. */
export const aiContext = <T,>(projectId: string | null, fn: () => Promise<T>) => projectCtx.run(projectId, fn);
let spendCache: [number, { today: number; month: number }] | null = null;

export function recordCall(doc: { provider: string; model: string; task: string; ok: boolean; latencyMs: number; inputTokens?: number | null; outputTokens?: number | null;
  cachedTokens?: number | null; cost?: number | null; fallbackUsed?: boolean; errorCode?: string | null; requestId?: string | null }) {
  const row = { ts: new Date(), projectId: projectCtx.getStore() ?? null, inputTokens: null, outputTokens: null, cachedTokens: null, cost: null, fallbackUsed: false, errorCode: null, requestId: null, ...doc };
  void db().then((d) => d.collection("ai_usage").insertOne(row)).catch((e) => console.warn("could not write the AI usage log:", (e as Error).name));
  if (doc.cost) spendCache = null;
}

function starts(now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(day); week.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return { today: day, week, month: new Date(day.getFullYear(), day.getMonth(), 1) };
}
type Row = { ts: Date; provider?: string; task?: string; ok?: boolean; cost?: number | null; fallbackUsed?: boolean };
/** what each kind of AI work costs (shot picking, the director, captions, copying a Reel…): calls and cost, the dearest first */
function byTask(rows: Row[]) {
  const m = new Map<string, { calls: number; cost: number }>();
  for (const r of rows) { const t = m.get(r.task ?? "general") ?? { calls: 0, cost: 0 }; t.calls++; t.cost += Number(r.cost ?? 0); m.set(r.task ?? "general", t); }
  return [...m].sort((a, b) => b[1].cost - a[1].cost).map(([task, v]) => ({ task, calls: v.calls, cost: toDisplay(v.cost), perCall: toDisplay(v.calls ? v.cost / v.calls : 0) }));
}
function aggregate(rows: Row[]) {
  const by = new Map<string, { calls: number; ok: number; failed: number; cost: number }>();
  let total = 0, priced = true;
  for (const r of rows) {
    const p = by.get(r.provider ?? "?") ?? { calls: 0, ok: 0, failed: 0, cost: 0 };
    p.calls++;
    if (r.ok) p.ok++; else p.failed++;
    if ((r.cost === null || r.cost === undefined) && r.ok && r.provider !== "ollama") priced = false;
    p.cost += Number(r.cost ?? 0); total += Number(r.cost ?? 0);
    by.set(r.provider ?? "?", p);
  }
  return { tasks: byTask(rows), calls: rows.length, ok: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok).length, fallbacks: rows.filter((r) => r.fallbackUsed).length, cost: toDisplay(total), allPriced: priced,
    providers: [...by].sort(([a], [b]) => a.localeCompare(b)).map(([provider, v]) => ({ provider, ...v, cost: toDisplay(v.cost) })) };
}
export async function usageSummary(now = new Date()) {
  const s = starts(now), since = s.month < s.week ? s.month : s.week;
  let rows: Row[] = [];
  try { rows = (await (await db()).collection("ai_usage").find({ ts: { $gte: since } }, { projection: { _id: 0 } }).toArray()) as unknown as Row[]; } catch (e) { console.warn("could not read the AI usage log:", e); }
  return { today: aggregate(rows.filter((r) => r.ts >= s.today)), week: aggregate(rows.filter((r) => r.ts >= s.week)), month: aggregate(rows.filter((r) => r.ts >= s.month)), currency: settings.aiCurrency };
}
async function spent() {
  if (spendCache && Date.now() - spendCache[0] < 20_000) return spendCache[1];
  const s = await usageSummary();
  const out = { today: Number(s.today.cost ?? 0), month: Number(s.month.cost ?? 0) };
  spendCache = [Date.now(), out];
  return out;
}
export async function budgetState(cfg: EffectiveAIConfig) {
  if (!cfg.dailyBudget && !cfg.monthlyBudget) return { exceeded: false, reason: null as string | null, dailySpent: null as number | null, monthlySpent: null as number | null };
  const sp = await spent();
  const reason = cfg.dailyBudget && sp.today >= cfg.dailyBudget ? "today's AI budget is used up" : cfg.monthlyBudget && sp.month >= cfg.monthlyBudget ? "this month's AI budget is used up" : null;
  return { exceeded: reason !== null, reason, dailySpent: sp.today, monthlySpent: sp.month };
}
