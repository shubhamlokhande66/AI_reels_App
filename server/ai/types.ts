import { z } from "zod";
import { AppError } from "@/server/core/errors";

/** Provider-neutral AI types (was ai/types.py, provider.py helpers, structured.py): the request every provider takes,
 * the normalized result and error, JSON parsing, and validated structured answers. Nothing vendor-specific leaves a
 * provider. */

export const ERROR_KINDS = ["timeout", "rate_limit", "quota", "auth", "temporary", "unavailable", "model_missing", "not_configured", "bad_request", "refusal", "invalid_response", "unsupported", "budget"];
const RETRYABLE = new Set(["rate_limit", "temporary", "unavailable"]);
const FALLBACK_OK = new Set(["timeout", "rate_limit", "quota", "auth", "temporary", "unavailable", "model_missing", "not_configured"]);
const KEYLIKE = /\b(sk-[A-Za-z0-9_\-*]{6,}|AIza[0-9A-Za-z_-]{10,})/g;

/** Remove API keys (the configured ones and anything shaped like a key) from text that may be shown or logged. */
export function redact(text: string, ...secrets: string[]): string {
  for (const s of secrets) if (s && s.length >= 6) text = text.split(s).join("***");
  return text.replace(KEYLIKE, "***");
}

/** A normalized provider failure; its message is safe to show and never contains a key. */
export class AIProviderError extends AppError {
  kind: string;
  provider: string;
  retryAfter: number | null;
  constructor(message: string, o: { kind: string; provider: string; code?: string; details?: unknown; status?: number; retryAfter?: number | null }) {
    super(message, { code: o.code ?? `AI_${o.kind.toUpperCase()}`, details: o.details, status: o.status ?? 503 });
    this.kind = ERROR_KINDS.includes(o.kind) ? o.kind : "unavailable";
    this.provider = o.provider;
    this.retryAfter = o.retryAfter ?? null;
  }
  get retryable() { return RETRYABLE.has(this.kind); }
  get fallbackOk() { return FALLBACK_OK.has(this.kind); }
}

export class AIResponseError extends AppError {
  constructor(message: string, o: { details?: unknown } = {}) { super(message, { code: "AI_BAD_RESPONSE", status: 502, details: o.details }); }
}

export interface Message { role: "user" | "assistant"; content: string; images?: string[] }
export interface AIRequest {
  system: string; user?: string; messages?: Message[] | null; images?: (Buffer | string)[]; schema?: z.ZodType | null; jsonMode?: boolean;
  temperature?: number | null; task?: string; maxOutputTokens?: number | null;
}
export const wantsJson = (r: AIRequest) => Boolean(r.jsonMode || r.schema);
export const isVision = (r: AIRequest) => Boolean(r.images?.length) || Boolean(r.messages?.some((m) => m.images?.length));

export interface AIResult {
  text: string; provider: string; model: string; parsed: Record<string, unknown> | null; latencyMs: number; inputTokens: number | null; outputTokens: number | null;
  cachedTokens: number | null; cost: number | null; requestId: string | null; warnings: string[]; fallbackUsed: boolean; task: string;
}
export const result = (o: Partial<AIResult> & Pick<AIResult, "text" | "provider" | "model">): AIResult => ({
  parsed: null, latencyMs: 0, inputTokens: null, outputTokens: null, cachedTokens: null, cost: null, requestId: null, warnings: [], fallbackUsed: false, task: "general", ...o,
});

// ------------------------------------------------------------------ JSON
function firstBraced(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
/** Parse an LLM reply into an object, tolerating code fences and chatter. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  for (const c of [cleaned, firstBraced(cleaned)]) {
    if (!c) continue;
    try { const v = JSON.parse(c); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  throw new AIResponseError("The AI model did not return valid JSON.", { details: text.slice(0, 300) });
}
export const tryParseJson = (text: string) => { try { return parseJsonObject(text); } catch { return null; } };

// ------------------------------------------------------------------ structured answers
/** A self-contained JSON schema of a zod model (no titles / defaults): small enough for a prompt. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  const strip = (n: unknown, fieldNames = false): unknown => {
    if (Array.isArray(n)) return n.map((x) => strip(x));
    if (!n || typeof n !== "object") return n;
    if (fieldNames) return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, strip(v)]));
    return Object.fromEntries(Object.entries(n).filter(([k]) => !["title", "default", "examples", "$schema"].includes(k)).map(([k, v]) => [k, strip(v, k === "properties")]));
  };
  return strip(raw) as Record<string, unknown>;
}
export const schemaHint = (schema: z.ZodType) => "Reply with ONE JSON object that matches this JSON schema exactly (no extra keys, no prose):\n" + JSON.stringify(jsonSchema(schema));

/** Every object closed with additionalProperties: false (schema-constrained output needs it). */
export function closedSchema(schema: Record<string, unknown>, allRequired = false): Record<string, unknown> {
  const out = structuredClone(schema);
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (o.type === "object" || o.properties) {
      o.additionalProperties = false;
      if (allRequired && o.properties) o.required = Object.keys(o.properties as object);
    }
    Object.values(o).forEach(walk);
  };
  walk(out);
  return out;
}

const issues = (e: z.ZodError, limit = 6) => e.issues.slice(0, limit).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

export interface Generator { generate(req: AIRequest): Promise<AIResult> }

/** Ask, validate, repair once, or throw AIResponseError. */
export async function runStructured<S extends z.ZodType>(provider: Generator, req: AIRequest, schema: S): Promise<[z.infer<S>, AIResult]> {
  const first = await provider.generate({ ...req, schema });
  let problem: string;
  const check = (r: AIResult) => {
    if (!r.parsed) throw new Error("the answer was not a JSON object");
    return schema.parse(r.parsed) as z.infer<S>;
  };
  try { return [check(first), first]; } catch (e) { problem = e instanceof z.ZodError ? issues(e) : String((e as Error).message); }
  const second = await provider.generate({
    ...req, schema, temperature: req.temperature !== null && req.temperature !== undefined ? 0 : null,
    user: `${req.user ?? ""}\n\nYour previous answer was not valid: ${problem}.\nPrevious answer: ${first.text.slice(0, 1500)}\nAnswer again with only the corrected JSON object.`,
    messages: req.messages ? [...req.messages, { role: "assistant", content: first.text.slice(0, 1500) }, { role: "user", content: `That was not valid (${problem}). Answer again with only the corrected JSON object.` }] : null,
  });
  try {
    const out = check(second);
    second.warnings.push("The first answer was invalid and was repaired.");
    return [out, second];
  } catch (e) {
    const detail = e instanceof z.ZodError ? issues(e) : String((e as Error).message);
    throw new AIResponseError(`The AI model's answer did not match the expected format (${detail.slice(0, 200)}).`, { details: second.text.slice(0, 300) });
  }
}

// ------------------------------------------------------------------ tasks
export interface TaskSpec { id: string; kind: "text" | "vision"; essential: boolean; label: string }
export const TASKS: Record<string, TaskSpec> = Object.fromEntries(([
  ["clip_understanding", "vision", false, "Clip understanding"], ["shot_ranking", "vision", false, "Fast Studio: AI shot picking"], ["studio_director", "text", false, "Fast Studio: AI director"], ["studio_translate", "text", false, "Fast Studio: caption translation"], ["product_understanding", "vision", false, "Product photo understanding"], ["style", "text", false, "Style selection"],
  ["story", "text", false, "Story planning"], ["order", "text", false, "Shot order"], ["director", "text", false, "Creative director"], ["product_director", "text", false, "Product creative director"],
  ["copy", "text", false, "Post copy"], ["music", "text", false, "Song part choice"], ["reviewer", "text", false, "Reel reviewer"], ["library_search", "text", false, "Library search"],
  ["hooks", "text", true, "Hook generation"], ["script", "text", true, "Script writing"], ["revision", "text", true, "Natural-language revision"], ["template", "text", true, "Template drafts"],
  ["chat", "text", true, "Chat"], ["test", "text", true, "Connection test"], ["general", "text", true, "Other"],
] as const).map(([id, kind, essential, label]) => [id, { id, kind, essential, label }]));
export const getTask = (task: string | null | undefined) => TASKS[task || "general"] ?? TASKS.general;
