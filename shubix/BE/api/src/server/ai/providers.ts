import { settings } from "../core/config";
import { estimateCost } from "./config";
import { AIProviderError, closedSchema, isVision, jsonSchema, result, schemaHint, tryParseJson, wantsJson, redact, type AIRequest, type AIResult } from "./types";

/** The AI vendors behind one interface (were ai/ollama.py, openai_provider.py, gemini_provider.py,
 * claude_provider.py), called over HTTP. Vendor payloads never leave a provider: everything becomes AIResult or
 * AIProviderError, and API keys never appear in messages. */

export interface Health { available: boolean; model: string | null; detail: string; errorKind?: string; installed?: string[] }

export abstract class Provider {
  abstract name: string;
  isLocal = false;
  model = "";
  visionModel = "";
  abstract generate(req: AIRequest): Promise<AIResult>;
  abstract health(): Promise<Health>;
  async listModels(): Promise<{ name: string; vision: boolean | null }[]> { return []; }
  modelFor(req: AIRequest) { return isVision(req) ? this.visionModel || this.model : this.model; }
  modelInfo() { return { provider: this.name, model: this.model || null, visionModel: (this.visionModel || this.model) || null, local: this.isLocal }; }
  protected cost(model: string, tin: number | null, tout: number | null, cached: number | null = null) { return this.isLocal ? 0 : estimateCost(model, tin, tout, cached); }
}

const b64 = (img: Buffer | string) => (typeof img === "string" ? img : img.toString("base64"));
const mimeOf = (data: Buffer) => (data.subarray(0, 4).toString("hex") === "89504e47" ? "image/png" : data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP" ? "image/webp" : data.subarray(0, 3).toString() === "GIF" ? "image/gif" : "image/jpeg");
const bytes = (img: Buffer | string) => (typeof img === "string" ? Buffer.from(img, "base64") : img);
const healthCache = new Map<string, [number, Health]>();
const HEALTH_TTL = 60_000;
async function cachedHealth(key: string, fn: () => Promise<Health>): Promise<Health> {
  const hit = healthCache.get(key);
  if (hit && Date.now() - hit[0] < HEALTH_TTL) return hit[1];
  const out = await fn();
  healthCache.set(key, [Date.now(), out]);
  return out;
}

/** fetch with a timeout; network failures and timeouts become provider errors. */
async function call(p: Provider, url: string, init: RequestInit, timeoutS: number, what: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(timeoutS, 1) * 1000) });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    throw new AIProviderError(timeout ? `${what} took too long to respond.` : `Cannot reach the ${what} API. Check the internet connection.`, { kind: timeout ? "timeout" : "unavailable", provider: p.name, code: `${p.name.toUpperCase()}_${timeout ? "TIMEOUT" : "UNAVAILABLE"}` });
  }
}
const retryAfter = (r: Response) => { const v = Number(r.headers.get("retry-after")); return Number.isFinite(v) && v > 0 ? v : null; };

// ------------------------------------------------------------------ Ollama (local)
export class OllamaProvider extends Provider {
  name = "ollama";
  isLocal = true;
  constructor(private baseUrl: string, model: string, private timeout = 60, visionModel = "") { super(); this.baseUrl = baseUrl.replace(/\/+$/, ""); this.model = model.trim(); this.visionModel = visionModel.trim(); }
  private err(message: string, kind: string, code: string, details: unknown = null) { return new AIProviderError(message, { kind, provider: this.name, code, details }); }
  async generate(req: AIRequest): Promise<AIResult> {
    const vision = isVision(req), model = this.modelFor(req);
    if (!model) throw this.err("No Ollama model configured. Set OLLAMA_MODEL to a model you have pulled (see `ollama list`).", "not_configured", "AI_MODEL_NOT_SET");
    const hint = req.schema ? "\n\n" + schemaHint(req.schema) : "";
    const messages: Record<string, unknown>[] = [{ role: "system", content: req.system }];
    if (req.messages) {
      for (const m of req.messages) messages.push({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images } : {}) });
      if (hint && messages[messages.length - 1].role === "user") messages[messages.length - 1].content += hint;
    } else messages.push({ role: "user", content: (req.user ?? "") + hint, ...(req.images?.length ? { images: req.images.map(b64) } : {}) });
    const options: Record<string, unknown> = { temperature: req.temperature ?? (vision ? 0.1 : 0.3) };
    if (req.maxOutputTokens) options.num_predict = req.maxOutputTokens;
    const started = Date.now();
    let r: Response;
    try {
      r = await fetch(`${this.baseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout((vision ? settings.visionTimeoutSeconds : this.timeout) * 1000),
        body: JSON.stringify({ model, messages, stream: false, options, think: false, keep_alive: vision ? "10m" : "30m", ...(wantsJson(req) ? { format: "json" } : {}) }) });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw this.err(`The ${vision ? "vision model" : "Ollama model"} took too long to respond.`, "timeout", "OLLAMA_TIMEOUT");
      throw this.err(`Cannot reach Ollama at ${this.baseUrl}. Is it running?`, "unavailable", "OLLAMA_UNAVAILABLE");
    }
    if (r.status === 404) throw this.err(`Ollama has no model named '${model}'. Pull it with \`ollama pull ${model}\`.`, "model_missing", "OLLAMA_MODEL_MISSING");
    if (r.status >= 400 && vision) throw this.err(`Ollama could not process the images (${r.status}). The model may not support vision.`, "unsupported", "AI_VISION_UNSUPPORTED", (await r.text()).slice(0, 300));
    if (r.status >= 400) throw this.err(`Ollama returned an error (${r.status}).`, r.status >= 500 ? "temporary" : "bad_request", "OLLAMA_ERROR", (await r.text()).slice(0, 300));
    let body: { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    try { body = await r.json(); } catch { throw this.err("Ollama returned an unexpected response.", "invalid_response", "OLLAMA_ERROR"); }
    const text = String(body.message?.content ?? "");
    return result({ text, provider: this.name, model, parsed: wantsJson(req) ? tryParseJson(text) : null, latencyMs: Date.now() - started,
      inputTokens: body.prompt_eval_count ?? null, outputTokens: body.eval_count ?? null, cost: 0, task: req.task ?? "general" });
  }
  async installedModels(): Promise<{ name: string; sizeGb: number; capabilities: string[] }[]> {
    let rows: { name: string; size?: number }[];
    try { const r = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) }); if (!r.ok) throw new Error(); rows = (await r.json()).models ?? []; }
    catch { throw this.err(`Cannot reach Ollama at ${this.baseUrl}. Is it running?`, "unavailable", "OLLAMA_UNAVAILABLE"); }
    const out = [];
    for (const m of rows) {
      let caps: string[] = [];
      try { caps = ((await (await fetch(`${this.baseUrl}/api/show`, { method: "POST", body: JSON.stringify({ model: m.name }), signal: AbortSignal.timeout(5000) })).json()).capabilities ?? []).map(String); } catch { /* informational */ }
      out.push({ name: String(m.name), sizeGb: Math.round((Number(m.size ?? 0) / 1e9) * 10) / 10, capabilities: caps });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async listModels() { return (await this.installedModels()).filter((m) => !(m.capabilities.length === 1 && m.capabilities[0] === "embedding")).map((m) => ({ name: m.name, vision: m.capabilities.includes("vision") })); }
  async health(): Promise<Health> {
    let installed: string[];
    try { const r = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) }); if (!r.ok) throw new Error(); installed = ((await r.json()).models ?? []).map((m: { name: string }) => m.name); }
    catch { return { available: false, model: this.model || null, detail: `Ollama not reachable at ${this.baseUrl}` }; }
    if (!this.model) return { available: false, model: null, detail: "OLLAMA_MODEL is not set", installed };
    const ok = installed.some((n) => n === this.model || n.split(":")[0] === this.model);
    return { available: ok, model: this.model, detail: ok ? "ready" : `model '${this.model}' is not pulled`, installed };
  }
}

// ------------------------------------------------------------------ OpenAI (Responses API)
export class OpenAIProvider extends Provider {
  name = "openai";
  constructor(private apiKey: string, model: string, visionModel = "", private timeout = 90, private baseUrl = "") { super(); this.apiKey = apiKey.trim(); this.model = model.trim(); this.visionModel = visionModel.trim(); }
  private url(path: string) { return `${(this.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}${path}`; }
  private err(message: string, kind: string, details: unknown = null, retry: number | null = null) { return new AIProviderError(message, { kind, provider: this.name, code: `OPENAI_${kind.toUpperCase()}`, details, retryAfter: retry }); }
  private headers() {
    if (!this.apiKey) throw this.err("OpenAI is not configured: set OPENAI_API_KEY in the backend .env file.", "not_configured");
    return { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" };
  }
  private imagePart(img: Buffer | string) {
    const data = b64(img), detail = ["low", "high", "auto"].includes(settings.visionDetailLevel) ? settings.visionDetailLevel : "low";
    return { type: "input_image", image_url: `data:${data.startsWith("iVBOR") ? "image/png" : "image/jpeg"};base64,${data}`, detail };
  }
  private input(req: AIRequest) {
    if (!req.messages) return [{ role: "user", content: [{ type: "input_text", text: req.user ?? "" }, ...(req.images ?? []).map((i) => this.imagePart(i))] }];
    return req.messages.map((m) => (m.role === "assistant" ? { role: "assistant", content: m.content } : { role: "user", content: [{ type: "input_text", text: m.content }, ...(m.images ?? []).map((i) => this.imagePart(i))] }));
  }
  private async normalize(r: Response): Promise<AIProviderError> {
    let body: { error?: { message?: string; code?: string; type?: string } } = {};
    try { body = await r.json(); } catch { /* not JSON */ }
    const code = body.error?.code ?? "", details = { status: r.status, type: code || body.error?.type || null };
    if (r.status === 429) return code === "insufficient_quota" ? this.err("OpenAI quota or billing limit reached for this API key.", "quota", details) : this.err("OpenAI rate limit reached; waiting and trying again.", "rate_limit", details, retryAfter(r));
    if (r.status === 401 || r.status === 403) return this.err("OpenAI rejected the API key (check OPENAI_API_KEY and its permissions).", "auth", details);
    if (r.status === 404) return this.err(`OpenAI has no model named '${this.model}' for this key (check the model name).`, "model_missing", details);
    if (r.status === 400 || r.status === 422) return this.err(`OpenAI could not process the request: ${redact(body.error?.message ?? "", this.apiKey).slice(0, 160)}`, "bad_request", details);
    if (r.status >= 500) return this.err("OpenAI had a temporary problem; try again.", "temporary", details);
    return this.err("OpenAI returned an error.", "temporary", details);
  }
  async generate(req: AIRequest): Promise<AIResult> {
    const model = this.modelFor(req);
    if (!model) throw this.err(`No OpenAI model configured: set ${isVision(req) ? "OPENAI_VISION_MODEL / OPENAI_TEXT_MODEL" : "OPENAI_TEXT_MODEL"} (or choose one in Settings).`, "not_configured");
    const headers = this.headers(), started = Date.now();
    for (const strict of [true, false]) {
      let format: Record<string, unknown> | null = null, extra = "";
      if (req.schema && strict) format = { type: "json_schema", name: "answer", schema: closedSchema(jsonSchema(req.schema), true), strict: true };
      else if (wantsJson(req)) { format = { type: "json_object" }; extra = "\n\nReply in JSON." + (req.schema ? "\n" + schemaHint(req.schema) : ""); }
      let input: unknown[] = this.input(req);
      if (format?.type === "json_object") input = [...input, { role: "user", content: "Answer in json." }];
      const body: Record<string, unknown> = { model, instructions: req.system + extra, input, store: false, ...(format ? { text: { format } } : {}) };
      if (settings.openaiReasoningEffort.trim()) body.reasoning = { effort: settings.openaiReasoningEffort.trim() };
      const r = await call(this, this.url("/responses"), { method: "POST", headers, body: JSON.stringify(body) }, this.timeout, "OpenAI");
      if (!r.ok) {
        const e = await this.normalize(r);
        if (strict && format?.type === "json_schema" && e.kind === "bad_request" && e.message.toLowerCase().includes("schema")) continue;
        throw e;
      }
      return this.result(await r.json(), req, model, started, r);
    }
    throw this.err("OpenAI could not answer in the requested format.", "invalid_response");
  }
  private result(resp: Record<string, unknown>, req: AIRequest, model: string, started: number, r: Response): AIResult {
    const output = (resp.output as { content?: { type: string; text?: string; refusal?: string }[] }[]) ?? [];
    for (const item of output) for (const part of item.content ?? []) if (part.type === "refusal") throw this.err("OpenAI declined this request.", "refusal", { refusal: String(part.refusal ?? "").slice(0, 200) });
    const warnings: string[] = [];
    if (resp.status === "incomplete") {
      const reason = (resp.incomplete_details as { reason?: string } | undefined)?.reason || "unknown";
      if (reason === "content_filter") throw this.err("OpenAI stopped the answer (content filter).", "refusal");
      warnings.push(`The answer was cut short (${reason}).`);
    }
    const text = typeof resp.output_text === "string" ? resp.output_text : output.flatMap((i) => (i.content ?? []).filter((p) => p.type === "output_text").map((p) => p.text ?? "")).join("");
    const usage = (resp.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }) ?? {};
    const used = String(resp.model ?? model);
    return result({ text, provider: this.name, model: used, parsed: wantsJson(req) ? tryParseJson(text) : null, latencyMs: Date.now() - started, inputTokens: usage.input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null, cachedTokens: usage.input_tokens_details?.cached_tokens ?? null,
      cost: this.cost(used, usage.input_tokens ?? null, usage.output_tokens ?? null, usage.input_tokens_details?.cached_tokens ?? null),
      requestId: r.headers.get("x-request-id") ?? (resp.id as string) ?? null, warnings, task: req.task ?? "general" });
  }
  async listModels() {
    const r = await call(this, this.url("/models"), { headers: this.headers() }, 15, "OpenAI");
    if (!r.ok) throw await this.normalize(r);
    return [...new Set(((await r.json()).data ?? []).map((m: { id: string }) => m.id))].sort().map((name) => ({ name: name as string, vision: null }));
  }
  async health(): Promise<Health> {
    if (!this.apiKey) return { available: false, model: this.model || null, detail: "OPENAI_API_KEY is not set" };
    if (!this.model) return { available: false, model: null, detail: "OPENAI_TEXT_MODEL is not set" };
    return cachedHealth(`openai:${this.model}`, async () => {
      try {
        const r = await call(this, this.url(`/models/${encodeURIComponent(this.model)}`), { headers: this.headers() }, 8, "OpenAI");
        if (r.ok) return { available: true, model: this.model, detail: "ready" };
        const e = await this.normalize(r);
        return { available: false, model: this.model, detail: e.message, errorKind: e.kind };
      } catch (e) { return { available: false, model: this.model, detail: (e as AIProviderError).message, errorKind: (e as AIProviderError).kind }; }
    });
  }
}

// ------------------------------------------------------------------ Gemini
const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"]);
export class GeminiProvider extends Provider {
  name = "gemini";
  constructor(private apiKey: string, model: string, visionModel = "", private timeout = 90) { super(); this.apiKey = apiKey.trim(); this.model = model.trim(); this.visionModel = visionModel.trim(); }
  private err(message: string, kind: string, details: unknown = null, retry: number | null = null) { return new AIProviderError(message, { kind, provider: this.name, code: `GEMINI_${kind.toUpperCase()}`, details, retryAfter: retry }); }
  private url(path: string) {
    if (!this.apiKey) throw this.err("Gemini is not configured: set GEMINI_API_KEY in the backend .env file.", "not_configured");
    return `https://generativelanguage.googleapis.com/v1beta${path}`;
  }
  private headers() { return { "x-goog-api-key": this.apiKey, "content-type": "application/json" }; }
  private parts(text: string, images: (Buffer | string)[]) {
    return [...(text ? [{ text }] : []), ...images.map((i) => { const d = bytes(i); return { inline_data: { mime_type: d.subarray(0, 4).toString("hex") === "89504e47" ? "image/png" : "image/jpeg", data: d.toString("base64") } }; })];
  }
  private async normalize(r: Response): Promise<AIProviderError> {
    let body: { error?: { code?: number; status?: string; message?: string; details?: Record<string, unknown>[] } } = {};
    try { body = await r.json(); } catch { /* not JSON */ }
    const e = body.error ?? {}, code = e.code ?? r.status, status = e.status ?? "", message = redact(e.message ?? "", this.apiKey), low = message.toLowerCase(), details = { status: code, type: status };
    if (code === 401 || code === 403 || low.includes("api key") || ["UNAUTHENTICATED", "PERMISSION_DENIED"].includes(status)) return this.err("Gemini rejected the API key (check GEMINI_API_KEY).", "auth", details);
    if (code === 429 || status === "RESOURCE_EXHAUSTED") {
      let perDay = false, perMinute = false, wait: number | null = null;
      for (const it of e.details ?? []) {
        const t = String(it["@type"] ?? "");
        if (t.endsWith("RetryInfo")) { const v = parseFloat(String(it.retryDelay ?? "").replace(/s$/, "")); wait = Number.isFinite(v) ? v : null; }
        if (t.endsWith("QuotaFailure")) for (const v of (it.violations as { quotaId?: string }[]) ?? []) { perDay ||= String(v.quotaId ?? "").includes("PerDay"); perMinute ||= String(v.quotaId ?? "").includes("PerMinute"); }
      }
      if (perDay && !perMinute) return this.err("Gemini's daily quota for this API key is used up (it resets tomorrow, or raise the limit).", "quota", details);
      return this.err("Gemini's per-minute request limit was reached; waiting and trying again.", "rate_limit", details, wait);
    }
    if (code === 404) return this.err(`Gemini has no model named '${this.model}' (check the model name).`, "model_missing", details);
    if (code === 504 || status === "DEADLINE_EXCEEDED") return this.err("Gemini took too long to respond.", "timeout", details);
    if (code >= 500) return this.err("Gemini had a temporary problem; try again.", "temporary", details);
    return this.err(`Gemini could not process the request: ${message.slice(0, 160)}`, "bad_request", details);
  }
  async generate(req: AIRequest): Promise<AIResult> {
    const model = this.modelFor(req);
    if (!model) throw this.err(`No Gemini model configured: set ${isVision(req) ? "GEMINI_VISION_MODEL / GEMINI_TEXT_MODEL" : "GEMINI_TEXT_MODEL"} (or choose one in Settings).`, "not_configured");
    const contents = req.messages ? req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: this.parts(m.content, m.images ?? []) })) : [{ role: "user", parts: [...this.parts(req.user ?? "", req.images ?? []), ...(req.audio ? [{ inline_data: { mime_type: req.audio.mime, data: req.audio.data.toString("base64") } }] : [])] }];
    const config: Record<string, unknown> = {};
    if (req.temperature !== null && req.temperature !== undefined) config.temperature = req.temperature;
    if (wantsJson(req)) config.responseMimeType = "application/json";
    if (req.schema) config.responseJsonSchema = jsonSchema(req.schema);
    const started = Date.now();
    const r = await call(this, this.url(`/models/${encodeURIComponent(model)}:generateContent`), { method: "POST", headers: this.headers(),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: req.system }] }, contents, generationConfig: config }) }, this.timeout, "Gemini");
    if (!r.ok) throw await this.normalize(r);
    const resp = await r.json() as { promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number }; modelVersion?: string; responseId?: string };
    if (resp.promptFeedback?.blockReason) throw this.err("Gemini declined this request.", "refusal", { reason: resp.promptFeedback.blockReason });
    const cands = resp.candidates ?? [], warnings: string[] = [];
    if (cands.length) {
      const reason = String(cands[0].finishReason ?? "").toUpperCase();
      if (BLOCKED.has(reason)) throw this.err("Gemini declined this request.", "refusal", { reason });
      if (reason === "MAX_TOKENS") warnings.push("The answer was cut short (length limit).");
    }
    const text = (cands[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    if (!text && !cands.length) throw this.err("Gemini returned an empty answer.", "invalid_response");
    const um = resp.usageMetadata, tin = um?.promptTokenCount ?? null, tout = um ? (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0) : null, cached = um?.cachedContentTokenCount ?? null;
    return result({ text, provider: this.name, model: resp.modelVersion || model, parsed: wantsJson(req) ? tryParseJson(text) : null, latencyMs: Date.now() - started, inputTokens: tin,
      outputTokens: tout || null, cachedTokens: cached, cost: this.cost(model, tin, tout, cached), requestId: resp.responseId ?? null, warnings, task: req.task ?? "general" });
  }
  async listModels() {
    const r = await call(this, this.url("/models?pageSize=1000"), { headers: this.headers() }, 15, "Gemini");
    if (!r.ok) throw await this.normalize(r);
    return ((await r.json()).models ?? []).filter((m: { supportedGenerationMethods?: string[] }) => !m.supportedGenerationMethods?.length || m.supportedGenerationMethods.includes("generateContent"))
      .map((m: { name: string }) => ({ name: m.name.replace(/^models\//, ""), vision: null })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  }
  async health(): Promise<Health> {
    if (!this.apiKey) return { available: false, model: this.model || null, detail: "GEMINI_API_KEY is not set" };
    if (!this.model) return { available: false, model: null, detail: "GEMINI_TEXT_MODEL is not set" };
    return cachedHealth(`gemini:${this.model}`, async () => {
      try {
        const r = await call(this, this.url(`/models/${encodeURIComponent(this.model)}`), { headers: this.headers() }, 8, "Gemini");
        if (r.ok) return { available: true, model: this.model, detail: "ready" };
        const e = await this.normalize(r);
        return { available: false, model: this.model, detail: e.message, errorKind: e.kind };
      } catch (e) { return { available: false, model: this.model, detail: (e as AIProviderError).message, errorKind: (e as AIProviderError).kind }; }
    });
  }
}

// ------------------------------------------------------------------ Claude (Anthropic Messages API)
export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16000, EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const FALLBACK_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"], FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ClaudeProvider extends Provider {
  name = "claude";
  private effort: string;
  constructor(private apiKey: string, model: string, visionModel = "", private timeout = 180, effort = "medium") {
    super(); this.apiKey = apiKey.trim(); this.model = model.trim() || CLAUDE_DEFAULT_MODEL; this.visionModel = visionModel.trim(); this.effort = EFFORTS.includes(effort) ? effort : "medium";
  }
  private err(message: string, kind: string, details: unknown = null, retry: number | null = null) { return new AIProviderError(message, { kind, provider: this.name, code: `CLAUDE_${kind.toUpperCase()}`, details, retryAfter: retry }); }
  private headers(beta: string | null = null) {
    if (!this.apiKey) throw this.err("Claude is not configured: set ANTHROPIC_API_KEY in the backend .env file.", "not_configured");
    return { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(beta ? { "anthropic-beta": beta } : {}) };
  }
  private content(text: string, images: (Buffer | string)[]) {
    const blocks: Record<string, unknown>[] = images.map((i) => { const d = bytes(i); return { type: "image", source: { type: "base64", media_type: mimeOf(d), data: d.toString("base64") } }; });
    if (text) blocks.push({ type: "text", text });
    return blocks.length ? blocks : [{ type: "text", text: "." }];
  }
  private messages(req: AIRequest) {
    if (!req.messages) return [{ role: "user", content: this.content(req.user ?? "", req.images ?? []) }];
    const out = req.messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: this.content(m.content, m.images ?? []) }));
    if (out.length && out[0].role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "(conversation continues)" }] });
    return out;
  }
  private async normalize(r: Response): Promise<AIProviderError> {
    let body: { error?: { message?: string } } = {};
    try { body = await r.json(); } catch { /* not JSON */ }
    const message = redact(body.error?.message ?? "", this.apiKey), details = { status: r.status, requestId: r.headers.get("request-id") };
    if (r.status === 401 || r.status === 403) return this.err("Claude rejected the API key (check ANTHROPIC_API_KEY).", "auth", details);
    if (r.status === 429) return this.err("Claude's rate limit was reached; waiting and trying again.", "rate_limit", details, retryAfter(r));
    if (r.status === 404) return this.err(`Claude has no model named '${this.model}' (check the model name).`, "model_missing", details);
    if (r.status === 529 || r.status >= 500) return this.err("Claude is temporarily overloaded; try again.", "temporary", details);
    if (r.status === 400 && message.toLowerCase().includes("credit")) return this.err("The Claude account has no credit left.", "quota", details);
    return this.err(`Claude could not process the request: ${message.slice(0, 160)}`, "bad_request", details);
  }
  async generate(req: AIRequest): Promise<AIResult> {
    const model = this.modelFor(req), started = Date.now();
    for (const constrained of req.schema ? [true, false] : [false]) {
      let system = req.system;
      const outputConfig: Record<string, unknown> = { effort: this.effort };
      if (req.schema && constrained) outputConfig.format = { type: "json_schema", schema: closedSchema(jsonSchema(req.schema)) };
      else if (req.schema) system = `${system}\n\n${schemaHint(req.schema)}`;
      else if (req.jsonMode) system = `${system}\n\nReply with ONE JSON object only: no Markdown, no code fences, no prose.`;
      const fallback = FALLBACK_MODELS.includes(model);
      const body = { model, max_tokens: req.maxOutputTokens || MAX_TOKENS, system, messages: this.messages(req), output_config: outputConfig, ...(fallback ? { fallbacks: "default" } : {}) };
      const r = await call(this, "https://api.anthropic.com/v1/messages", { method: "POST", headers: this.headers(fallback ? FALLBACK_BETA : null), body: JSON.stringify(body) }, this.timeout, "Claude");
      if (!r.ok) {
        const e = await this.normalize(r);
        if (constrained && e.kind === "bad_request" && e.message.toLowerCase().includes("schema")) continue;
        throw e;
      }
      const resp = await r.json() as { stop_reason?: string; stop_details?: { category?: string }; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }; model?: string; id?: string };
      if (resp.stop_reason === "refusal") throw this.err("Claude declined this request.", "refusal", { category: resp.stop_details?.category ?? null });
      const warnings: string[] = [];
      if (resp.stop_reason === "max_tokens") warnings.push("The answer was cut short (length limit).");
      if ((resp.content ?? []).some((b) => b.type === "fallback")) warnings.push("The main Claude model declined part of this request; a fallback model answered.");
      const text = (resp.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      if (!text) throw this.err("Claude returned an empty answer.", "invalid_response");
      const cached = resp.usage?.cache_read_input_tokens ?? null;
      let tin = resp.usage?.input_tokens ?? null;
      if (tin !== null && cached) tin += cached;
      const tout = resp.usage?.output_tokens ?? null, used = resp.model || model;
      return result({ text, provider: this.name, model: used, parsed: wantsJson(req) ? tryParseJson(text) : null, latencyMs: Date.now() - started, inputTokens: tin, outputTokens: tout,
        cachedTokens: cached, cost: this.cost(used, tin, tout, cached), requestId: r.headers.get("request-id") ?? resp.id ?? null, warnings, task: req.task ?? "general" });
    }
    throw this.err("Claude could not answer in the requested format.", "invalid_response");
  }
  async listModels() {
    const r = await call(this, "https://api.anthropic.com/v1/models?limit=1000", { headers: this.headers() }, 15, "Claude");
    if (!r.ok) throw await this.normalize(r);
    return ((await r.json()).data ?? []).map((m: { id: string }) => ({ name: m.id, vision: true })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  }
  async health(): Promise<Health> {
    if (!this.apiKey) return { available: false, model: this.model, detail: "ANTHROPIC_API_KEY is not set" };
    return cachedHealth(`claude:${this.model}`, async () => {
      try {
        const r = await call(this, `https://api.anthropic.com/v1/models/${encodeURIComponent(this.model)}`, { headers: this.headers() }, 8, "Claude");
        if (r.ok) return { available: true, model: this.model, detail: "ready" };
        const e = await this.normalize(r);
        return { available: false, model: this.model, detail: e.message, errorKind: e.kind };
      } catch (e) { return { available: false, model: this.model, detail: (e as AIProviderError).message, errorKind: (e as AIProviderError).kind }; }
    });
  }
}
