import type { z } from "zod";
import { settings } from "../core/config";
import { AIUnavailable } from "../core/errors";
import { budgetState, effective, PROVIDERS, providerFor, recordCall, type EffectiveAIConfig } from "./config";
import { ClaudeProvider, GeminiProvider, OllamaProvider, OpenAIProvider, Provider, type Health } from "./providers";
import { AIProviderError, AIResponseError, getTask, runStructured, type AIRequest, type AIResult, type Message } from "./types";

/** The provider the app talks to (was ai/managed.py + factory.py + provider.py helpers): budget check -> retries ->
 * optional fallback -> usage log; plus the familiar chat helpers. */

const BACKOFF = [1, 3, 6, 10, 15], MAX_WAIT = 65;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

export class ManagedProvider {
  lastResult: AIResult | null = null;
  readonly fallback: Provider | null;
  constructor(readonly primary: Provider, readonly task = "general", fallback: Provider | null = null, private maxRetries = 2, private config: EffectiveAIConfig | null = null) {
    this.fallback = fallback && fallback.name !== primary.name ? fallback : null;
  }
  get name() { return this.primary.name; }
  get model() { return this.primary.model; }
  get visionModel() { return this.primary.visionModel; }
  get isLocal() { return this.primary.isLocal; }
  health(): Promise<Health> { return this.primary.health(); }
  listModels() { return this.primary.listModels(); }
  modelInfo() { return { ...this.primary.modelInfo(), fallback: this.fallback?.name ?? null }; }

  private async checkBudget(task: string) {
    if (!this.config || getTask(task).essential || this.config.budgetOverride) return;
    const st = await budgetState(this.config);
    if (st.exceeded) throw new AIProviderError(`AI was skipped: ${st.reason} (turn on the budget override in Settings to continue).`, { kind: "budget", provider: this.primary.name, code: "AI_BUDGET_EXCEEDED" });
  }
  private async attempt(p: Provider, req: AIRequest, fallbackUsed: boolean): Promise<AIResult> {
    for (let tries = 0; ; tries++) {
      const started = Date.now();
      try {
        const res = await p.generate(req);
        res.fallbackUsed = fallbackUsed;
        res.task = req.task ?? "general";
        recordCall({ provider: res.provider, model: res.model, task: res.task, ok: true, latencyMs: res.latencyMs, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
          cachedTokens: res.cachedTokens, cost: res.cost, fallbackUsed, requestId: res.requestId });
        return res;
      } catch (e) {
        if (!(e instanceof AIProviderError)) throw e;
        recordCall({ provider: p.name, model: p.modelFor(req), task: req.task ?? "general", ok: false, latencyMs: Date.now() - started, fallbackUsed, errorCode: e.code });
        const again = e.retryable || (e.kind === "timeout" && !p.isLocal && tries === 0);
        if (!again || tries >= this.maxRetries) throw e;
        await sleep(e.retryAfter ? Math.min(Math.max(e.retryAfter + 0.5, 1), MAX_WAIT) : BACKOFF[Math.min(tries, BACKOFF.length - 1)]);
      }
    }
  }
  async generate(reqIn: AIRequest): Promise<AIResult> {
    const req = { ...reqIn, task: !reqIn.task || reqIn.task === "general" ? this.task : reqIn.task };
    await this.checkBudget(req.task);
    let res: AIResult;
    try {
      res = await this.attempt(this.primary, req, false);
    } catch (e) {
      if (!(e instanceof AIProviderError) || !this.fallback || !e.fallbackOk) throw e;
      console.warn(`AI provider ${this.primary.name} failed for ${req.task} (${e.kind}); using fallback ${this.fallback.name}`);
      try { res = await this.attempt(this.fallback, req, true); }
      catch (f) { throw new AIProviderError(`${e.message} The fallback (${this.fallback.name}) also failed: ${(f as Error).message}`, { kind: e.kind, provider: this.primary.name, code: e.code }); }
      res.warnings.push(`${this.primary.name} was unavailable (${e.kind}); ${this.fallback.name} answered instead.`);
    }
    this.lastResult = res;
    return res;
  }

  async structured<S extends z.ZodType>(system: string, user: string, schema: S, o: { task?: string; temperature?: number | null; messages?: Message[] | null; maxOutputTokens?: number | null } = {}): Promise<z.infer<S>> {
    return (await runStructured(this, { system, user, messages: o.messages ?? null, temperature: o.temperature ?? null, task: o.task, maxOutputTokens: o.maxOutputTokens ?? null }, schema))[0];
  }
  async audioStructured<S extends z.ZodType>(system: string, user: string, audio: { data: Buffer; mime: string }, schema: S, o: { task?: string; temperature?: number | null } = {}): Promise<z.infer<S>> {
    return (await runStructured(this, { system, user, audio, temperature: o.temperature ?? 0.2, task: o.task }, schema))[0];
  }
  async visionStructured<S extends z.ZodType>(system: string, user: string, images: (Buffer | string)[], schema: S, o: { task?: string; temperature?: number | null } = {}): Promise<z.infer<S>> {
    return (await runStructured(this, { system, user, images, temperature: o.temperature ?? 0.1, task: o.task ?? "clip_understanding" }, schema))[0];
  }
}

/** The raw provider with its configured models (no retries, fallback or logging). */
export function buildProvider(name: string, cfg: EffectiveAIConfig = effective()): Provider {
  if (!(PROVIDERS as readonly string[]).includes(name)) throw new AIUnavailable(`Unknown AI_PROVIDER '${name}'. Use one of: ${PROVIDERS.join(", ")}.`, { code: "AI_PROVIDER_UNKNOWN" });
  const [text, vision] = cfg.models[name];
  const v = vision !== text ? vision : "";
  if (name === "ollama") return new OllamaProvider(settings.ollamaBaseUrl, text, settings.aiTimeoutSeconds, v);
  if (name === "openai") return new OpenAIProvider(settings.openaiApiKey, text, v, settings.cloudAiTimeoutSeconds, settings.openaiBaseUrl);
  if (name === "claude") return new ClaudeProvider(settings.anthropicApiKey, text, v, settings.claudeTimeoutSeconds, settings.claudeEffort);
  return new GeminiProvider(settings.geminiApiKey, text, v, settings.cloudAiTimeoutSeconds);
}

const g = globalThis as unknown as { __aiOverride?: ManagedProvider | null };
/** Inject a provider for every task (tests). */
export const setProvider = (p: ManagedProvider | null) => { g.__aiOverride = p; };

/** The provider for `task` (routing, fallback, budget and usage logging included). */
export function getProvider(task: string | null = null): ManagedProvider {
  if (g.__aiOverride) return g.__aiOverride;
  const cfg = effective(), primary = buildProvider(providerFor(cfg, task), cfg);
  const fallback = cfg.fallbackEnabled && (PROVIDERS as readonly string[]).includes(cfg.fallbackProvider) && cfg.fallbackProvider !== primary.name ? buildProvider(cfg.fallbackProvider, cfg) : null;
  return new ManagedProvider(primary, task ?? "general", fallback, settings.aiMaxRetries, cfg);
}

/** Hearing sound: Gemini whichever provider does the other tasks (budget and usage logging included, no fallback: the others cannot hear). */
export function getAudioProvider(task: string): ManagedProvider {
  if (g.__aiOverride) return g.__aiOverride;
  if (!settings.geminiApiKey.trim()) throw new AIUnavailable("Hearing the song needs Gemini: set GEMINI_API_KEY.", { code: "AI_AUDIO_UNAVAILABLE" });
  const cfg = effective();
  return new ManagedProvider(buildProvider("gemini", cfg), task, null, settings.aiMaxRetries, cfg);
}

export { AIProviderError, AIResponseError };
