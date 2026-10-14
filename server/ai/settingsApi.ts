import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { settings } from "@/server/core/config";
import { AppError, ValidationFailed } from "@/server/core/errors";
import { localPath } from "@/server/storage/local";
import { budgetState, effective, getChosenModel, LOCAL_PROVIDERS, loadSaved, PROVIDERS, publicView, saveConfig, setChosenModel, usageSummary, type EffectiveAIConfig } from "./config";
import { buildProvider, ManagedProvider } from "./index";
import type { OllamaProvider } from "./providers";
import { AIProviderError, TASKS } from "./types";

/** The AI settings (was api/ai_settings.py): provider and models, fallback, budget, a connection test, usage.
 * API keys never leave the server: the browser only learns whether a key is configured. */

const LAST_TEST_KEY = "settings/ai_last_test.json";
const ollama = () => buildProvider("ollama") as OllamaProvider;

export async function ollamaState() {
  const p = ollama(), chosen = getChosenModel(), envModel = settings.ollamaModel;
  let models: { name: string; sizeGb: number; capabilities: string[] }[] = [], reachable = true, detail: string | null = null;
  try { models = await p.installedModels(); } catch (e) { reachable = false; detail = (e as AppError).message; }
  return {
    provider: "ollama", reachable, detail, current: p.model, source: chosen ? "settings" : envModel ? "env" : "none", envModel: envModel || null,
    models: models.map((m) => ({ ...m, vision: m.capabilities.includes("vision"), thinking: m.capabilities.includes("thinking"), embeddingOnly: m.capabilities.length === 1 && m.capabilities[0] === "embedding", current: m.name === p.model })),
    needsVision: "Content analysis (Analyse content, Library search) needs a model with vision.",
  };
}

export async function chooseOllamaModel(model: string | null) {
  const name = (model ?? "").trim() || null;
  if (name && !(await ollama().installedModels()).some((m) => m.name === name)) throw new ValidationFailed(`'${name}' is not installed in Ollama. Pull it first with \`ollama pull ${name}\`.`, { code: "MODEL_NOT_INSTALLED" });
  setChosenModel(name);
  return ollamaState();
}

const lastTest = () => { try { return JSON.parse(fs.readFileSync(localPath(LAST_TEST_KEY), "utf8")); } catch { return null; } };

async function status(cfg: EffectiveAIConfig) {
  const out: Record<string, unknown> = {};
  for (const [role, name] of [["text", cfg.textProvider], ["vision", cfg.visionProvider]] as const) {
    let h: Record<string, unknown>;
    try {
      const p = buildProvider(name, cfg);
      h = { ...(await p.health()) };
      if (role === "vision") h.model = p.visionModel || p.model || null;
    } catch (e) { h = { available: false, model: null, detail: (e as AppError).message }; }
    out[role] = { provider: name, local: LOCAL_PROVIDERS.has(name), ...h };
  }
  return out;
}

export async function configView() {
  const cfg = effective();
  return { ...publicView(cfg), status: await status(cfg), budget: await budgetState(cfg), lastTest: lastTest(),
    mode: LOCAL_PROVIDERS.has(cfg.textProvider) && LOCAL_PROVIDERS.has(cfg.visionProvider) ? "local" : "cloud",
    vision: { maxFramesPerClip: settings.visionMaxFramesPerClip, maxImageSize: settings.visionMaxImageSize, detail: settings.visionDetailLevel } };
}

const ModelsIn = z.object({ text: z.string().max(120).nullish(), vision: z.string().max(120).nullish() });
export const ConfigIn = z.object({
  provider: z.string().nullish(), textProvider: z.string().nullish(), visionProvider: z.string().nullish(), fallbackEnabled: z.boolean().nullish(), fallbackProvider: z.string().nullish(),
  models: z.record(z.string(), ModelsIn).nullish(), taskProviders: z.record(z.string(), z.string()).nullish(), dailyBudget: z.number().min(0).nullish(), monthlyBudget: z.number().min(0).nullish(),
  budgetOverride: z.boolean().nullish(),
});

function providerName(value: string, field: string, allowEmpty = false): string | null {
  const v = value.trim().toLowerCase();
  if (!v && allowEmpty) return null;
  if (!(PROVIDERS as readonly string[]).includes(v)) throw new ValidationFailed(`${field}: unknown provider '${value.slice(0, 30)}'. Use one of: ${PROVIDERS.join(", ")}.`, { code: "AI_PROVIDER_UNKNOWN" });
  return v;
}

/** Only the fields sent change; an empty model means "use the .env value". */
export async function putConfig(raw: Record<string, unknown>) {
  const p = ConfigIn.parse(raw), sent = new Set(Object.keys(raw)), saved = loadSaved();
  if (sent.has("provider") && p.provider) saved.provider = providerName(p.provider, "provider");
  if (sent.has("textProvider")) saved.textProvider = providerName(p.textProvider ?? "", "textProvider", true);
  if (sent.has("visionProvider")) saved.visionProvider = providerName(p.visionProvider ?? "", "visionProvider", true);
  if (sent.has("fallbackEnabled") && p.fallbackEnabled !== null && p.fallbackEnabled !== undefined) saved.fallbackEnabled = p.fallbackEnabled;
  if (sent.has("fallbackProvider")) saved.fallbackProvider = providerName(p.fallbackProvider ?? "", "fallbackProvider", true);
  if (sent.has("taskProviders") && p.taskProviders) {
    for (const [task, name] of Object.entries(p.taskProviders)) {
      if (!(task in TASKS)) throw new ValidationFailed(`Unknown AI task '${task.slice(0, 30)}'.`, { code: "AI_TASK_UNKNOWN" });
      providerName(name, `taskProviders.${task}`, true);
    }
    saved.taskProviders = Object.fromEntries(Object.entries(p.taskProviders).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim().toLowerCase()]));
  }
  const rawModels = (raw.models ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, m] of Object.entries(p.models ?? {})) {
    providerName(name, "models");
    const fields = new Set(Object.keys(rawModels[name] ?? {}));
    let text = (m.text ?? "").trim() || null;
    const vision = (m.vision ?? "").trim() || null;
    if (name === "ollama" && fields.has("text")) { setChosenModel(text); text = null; }
    const cur = saved.models[name] ?? { text: null, vision: null };
    if (fields.has("text") && name !== "ollama") cur.text = text;
    if (fields.has("vision")) cur.vision = vision;
    saved.models[name] = cur;
  }
  if (sent.has("dailyBudget")) saved.dailyBudget = p.dailyBudget ?? null;
  if (sent.has("monthlyBudget")) saved.monthlyBudget = p.monthlyBudget ?? null;
  if (sent.has("budgetOverride") && p.budgetOverride !== null && p.budgetOverride !== undefined) saved.budgetOverride = p.budgetOverride;
  saveConfig(saved);
  return configView();
}

export async function providerModels(provider: string) {
  const name = providerName(provider, "provider")!;
  try { return { provider: name, reachable: true, detail: null, models: await buildProvider(name).listModels() }; }
  catch (e) { return { provider: name, reachable: false, detail: (e as AppError).message, models: [] }; }
}

const TestAnswer = z.object({ status: z.string(), number: z.coerce.number().int() });

/** One tiny structured call to the provider (and optionally its vision model). */
export async function connectionTest(provider: string | null, vision: boolean) {
  const cfg = effective(), name = provider ? providerName(provider, "provider")! : cfg.textProvider, started = Date.now();
  const result: Record<string, unknown> = { provider: name, at: new Date().toISOString().slice(0, 19), vision };
  try {
    const p = new ManagedProvider(buildProvider(name, cfg), "test", null, 0, cfg);
    result.model = vision ? p.visionModel || p.model : p.model;
    let ans: z.infer<typeof TestAnswer>;
    if (vision) {
      const sharp = (await import("sharp")).default;
      const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 40, b: 40 } } }).jpeg().toBuffer();
      ans = await p.visionStructured("You check an AI connection.", "What colour is this square? Reply with status='ok' and number=1 if it is red, number=0 otherwise.", [jpg], TestAnswer, { task: "test" });
    } else ans = await p.structured("You check an AI connection.", "Reply with status='ok' and number=42.", TestAnswer, { task: "test" });
    const good = ans.status.trim().toLowerCase() === "ok" && ans.number === (vision ? 1 : 42), last = p.lastResult;
    Object.assign(result, { ok: true, correct: good, detail: good ? "Connected; the answer was correct." : "Connected, but the answer was not exactly right.",
      latencyMs: last?.latencyMs ?? Date.now() - started, inputTokens: last?.inputTokens ?? null, outputTokens: last?.outputTokens ?? null });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    Object.assign(result, { ok: false, correct: false, detail: e.message, errorCode: e.code, latencyMs: Date.now() - started, ...(e instanceof AIProviderError ? { errorKind: e.kind } : {}) });
  }
  try { const f = localPath(LAST_TEST_KEY); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(result)); } catch { /* a convenience */ }
  return result;
}

export async function usage() {
  const cfg = effective(), out = await usageSummary();
  return { ...out, budget: { ...(await budgetState(cfg)), daily: cfg.dailyBudget, monthly: cfg.monthlyBudget, override: cfg.budgetOverride } };
}
