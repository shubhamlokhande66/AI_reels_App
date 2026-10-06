"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { btnPrimary, btnSecondary, Card, ErrorBanner, Spinner } from "@/components/ui";
import type { AiConfig, AiConfigInput, AiProviderId, AiTestResult, AiUsagePeriod } from "@/types/api";

const SELECT = "w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm outline-none focus:border-accent";
const INPUT = SELECT;

/** LOCAL AI = nothing leaves this computer. CLOUD AI = compact metadata and a few small keyframes are sent. */
export function AiModeBadge({ local, provider, className = "" }: { local: boolean; provider?: string | null; className?: string }) {
  return (
    <span
      title={local ? "Local AI: no media leaves this computer." : "Cloud AI: only compact analysis data and a few small keyframes are sent, never whole videos."}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${
        local ? "border-success/40 text-success" : "border-accent/50 text-accent"
      } ${className}`}
    >
      {local ? "LOCAL AI" : "CLOUD AI"}
      {provider ? <span className="font-normal text-muted">· {provider}</span> : null}
    </span>
  );
}

function StatusLine({ label, s }: { label: string; s: AiConfig["status"]["text"] }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span>
        {label}: <strong>{s.provider}</strong> {s.model ? <span className="text-muted">· {s.model}</span> : null}
      </span>
      <span className={s.available ? "text-success" : "text-danger"}>
        {s.available ? "● Connected" : "● Unavailable"}
        {!s.available && s.detail && <span className="ml-2 text-muted">{s.detail}</span>}
      </span>
    </li>
  );
}

function TestResult({ r }: { r: AiTestResult }) {
  const tone = r.ok ? (r.correct ? "text-success" : "text-warning") : "text-danger";
  return (
    <div role="status" aria-label="AI test result" className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
      <p className={`font-medium ${tone}`}>
        {r.provider}
        {r.model ? ` · ${r.model}` : ""}
        {r.vision ? " (vision)" : ""}: {r.ok ? "connected" : "failed"} · {(r.latencyMs / 1000).toFixed(1)}s
      </p>
      <p className="mt-1 text-xs text-muted">
        {r.detail}
        {r.at ? ` · tested ${r.at.replace("T", " ")}` : ""}
      </p>
    </div>
  );
}

/** A model field: a dropdown of what the provider lists, with a free-text fallback for any other model name. */
function ModelField({ label, value, onChange, provider, allowEmpty }: {
  label: string; value: string; onChange: (v: string) => void; provider: AiProviderId; allowEmpty?: string;
}) {
  const q = useQuery({ queryKey: ["ai-provider-models", provider], queryFn: () => api.aiProviderModels(provider), staleTime: 60_000 });
  const names = q.data?.models.map((m) => m.name) ?? [];
  const [typing, setTyping] = useState(false); // only when the user asks to type a name the provider did not list
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {typing || names.length === 0 ? (
        <input aria-label={label} className={INPUT} value={value} placeholder={allowEmpty ?? "model name"} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <select aria-label={label} className={SELECT} value={value} onChange={(e) => (e.target.value === "__other" ? setTyping(true) : onChange(e.target.value))}>
          {allowEmpty && <option value="">{allowEmpty}</option>}
          {!value && !allowEmpty && <option value="">Choose a model…</option>}
          {value && !names.includes(value) && <option value={value}>{value} (configured)</option>}
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="__other">Other (type a name)…</option>
        </select>
      )}
      {q.data && !q.data.reachable && <span className="mt-1 block text-xs text-warning">Could not list models: {q.data.detail}</span>}
    </label>
  );
}

export function AiProviderCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai-config"], queryFn: api.aiConfig });
  if (q.isLoading) return <Spinner label="Loading AI settings…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const cfg = q.data;
  // keyed by what is saved, so the form always starts from the settings actually in use
  const key = JSON.stringify([cfg.provider, cfg.visionProvider, cfg.fallbackEnabled, cfg.fallbackProvider, cfg.providers]);
  return <ProviderForm key={key} cfg={cfg} onSaved={(c) => { qc.setQueryData(["ai-config"], c); qc.invalidateQueries({ queryKey: ["health"] }); }} />;
}

function ProviderForm({ cfg, onSaved }: { cfg: AiConfig; onSaved: (c: AiConfig) => void }) {
  const byId = Object.fromEntries(cfg.providers.map((p) => [p.id, p]));
  const [provider, setProvider] = useState<AiProviderId>(cfg.textProvider);
  const [visionProvider, setVisionProvider] = useState<AiProviderId | "">(cfg.visionProvider === cfg.textProvider ? "" : cfg.visionProvider);
  const [models, setModels] = useState(() =>
    Object.fromEntries(cfg.providers.map((p) => [p.id, { text: p.textModel ?? "", vision: p.visionModel && p.visionModel !== p.textModel ? p.visionModel : "" }])),
  );
  const [fallbackEnabled, setFallbackEnabled] = useState(cfg.fallbackEnabled);
  const [fallbackProvider, setFallbackProvider] = useState<AiProviderId | "">(cfg.fallbackProvider ?? "");
  const [result, setResult] = useState<AiTestResult | null>(cfg.lastTest);

  const save = useMutation({
    mutationFn: () => {
      const body: AiConfigInput = {
        provider, textProvider: "", visionProvider, fallbackEnabled, fallbackProvider,
        models: { [provider]: models[provider], ...(visionProvider ? { [visionProvider]: models[visionProvider] } : {}) },
      };
      return api.saveAiConfig(body);
    },
    onSuccess: onSaved,
  });
  const test = useMutation({ mutationFn: (vision: boolean) => api.testAi(provider, vision), onSuccess: setResult });
  const p = byId[provider];
  const vp = visionProvider ? byId[visionProvider] : p;
  const needsKey = (id: AiProviderId) => !byId[id].local && !byId[id].keyConfigured;
  const setModel = (id: string, field: "text" | "vision", v: string) => setModels((m) => ({ ...m, [id]: { ...m[id], [field]: v } }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">AI provider</h2>
        <AiModeBadge local={cfg.mode === "local"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">AI Provider</span>
          <select aria-label="AI Provider" className={SELECT} value={provider} onChange={(e) => setProvider(e.target.value as AiProviderId)}>
            {cfg.providers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
                {x.local ? " (local)" : x.keyConfigured ? " (cloud)" : " (no API key)"}
              </option>
            ))}
          </select>
        </label>
        <ModelField key={`t-${provider}`} label="Text Model" provider={provider} value={models[provider].text} onChange={(v) => setModel(provider, "text", v)} />
        {!visionProvider && (
          <ModelField key={`v-${provider}`} label="Vision Model" provider={provider} value={models[provider].vision} allowEmpty="Same as the text model"
                      onChange={(v) => setModel(provider, "vision", v)} />
        )}
      </div>
      {needsKey(provider) && (
        <p className="text-xs text-warning">
          {p.label} has no API key on the server. Add {({ openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", claude: "ANTHROPIC_API_KEY" } as Record<string, string>)[provider] ?? "the API key"} to the backend <code>.env</code> file
          and restart the backend. Keys are never entered or shown in the browser.
        </p>
      )}

      <details className="rounded-xl border border-border p-3 text-sm" open={!!visionProvider}>
        <summary className="cursor-pointer text-xs text-muted">Use a different provider for vision (clip understanding)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Vision provider</span>
            <select aria-label="Vision provider" className={SELECT} value={visionProvider} onChange={(e) => setVisionProvider(e.target.value as AiProviderId | "")}>
              <option value="">Same as the AI provider</option>
              {cfg.providers.filter((x) => x.id !== provider).map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
          </label>
          {visionProvider && (
            <ModelField key={`vp-${visionProvider}`} label="Vision Model" provider={visionProvider} value={models[visionProvider].vision || models[visionProvider].text}
                        onChange={(v) => setModel(visionProvider, "vision", v)} />
          )}
        </div>
        {visionProvider && needsKey(visionProvider) && <p className="mt-2 text-xs text-warning">{vp.label} has no API key on the server.</p>}
      </details>

      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label="Enable fallback" checked={fallbackEnabled} onChange={(e) => setFallbackEnabled(e.target.checked)} />
          Enable fallback
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">Fallback Provider (used only when the main provider is down, times out or is out of quota)</span>
          <select aria-label="Fallback Provider" className={SELECT} value={fallbackProvider} disabled={!fallbackEnabled}
                  onChange={(e) => setFallbackProvider(e.target.value as AiProviderId | "")}>
            <option value="">None</option>
            {cfg.providers.filter((x) => x.id !== provider).map((x) => (
              <option key={x.id} value={x.id}>{x.label}{needsKey(x.id) ? " (no API key)" : ""}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={btnSecondary} disabled={test.isPending} onClick={() => test.mutate(false)}>
          {test.isPending ? "Testing…" : "Test Connection"}
        </button>
        <button type="button" className={btnSecondary} disabled={test.isPending} onClick={() => test.mutate(true)}>
          Test vision
        </button>
      </div>
      <p className="text-xs text-muted">Save first, then test: the test uses the saved settings. It sends one tiny request and changes nothing.</p>
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
      {test.error && <ErrorBanner message={errorMessage(test.error)} />}
      {result && <TestResult r={result} />}

      <ul className="divide-y divide-border border-t border-border">
        <StatusLine label="Text" s={cfg.status.text} />
        <StatusLine label="Vision" s={cfg.status.vision} />
      </ul>
      <p className="text-xs text-muted">
        Vision sends at most {cfg.vision.maxFramesPerClip} distinct frames per clip, {cfg.vision.maxImageSize}px, detail “{cfg.vision.detail}”
        (VISION_MAX_FRAMES_PER_CLIP, VISION_MAX_IMAGE_SIZE, VISION_DETAIL_LEVEL in <code>.env</code>). Whole videos are never uploaded.
      </p>
    </div>
  );
}

function money(v: number | null | undefined, currency: string) {
  if (v === null || v === undefined) return "not priced";
  return `${currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `}${v.toFixed(v < 1 ? 4 : 2)}`;
}

function Period({ title, p, currency }: { title: string; p: AiUsagePeriod; currency: string }) {
  return (
    <div className="rounded-xl border border-border p-3 text-sm">
      <p className="text-xs text-muted">{title}</p>
      <p className="mt-1 text-lg font-semibold">{p.calls} calls</p>
      <p className="text-xs">
        <span className="text-success">{p.ok} ok</span> · <span className={p.failed ? "text-danger" : "text-muted"}>{p.failed} failed</span>
        {p.fallbacks ? <span className="text-warning"> · {p.fallbacks} fallback</span> : null}
      </p>
      <p className="mt-1 text-xs">Estimated cost: {money(p.cost, currency)}{!p.allPriced && p.calls ? " (some models not priced)" : ""}</p>
      {p.providers.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {p.providers.map((x) => (
            <li key={x.provider}>
              {x.provider}: {x.calls} ({x.failed} failed) · {money(x.cost, currency)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AiUsageCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai-usage"], queryFn: api.aiUsage, refetchInterval: 30_000 });
  const cfg = useQuery({ queryKey: ["ai-config"], queryFn: api.aiConfig });
  if (q.isLoading) return <Spinner label="Loading AI usage…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const u = q.data;
  return (
    <div className="space-y-4">
      <h2 className="font-semibold">AI usage</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Period title="Today" p={u.today} currency={u.currency} />
        <Period title="This week" p={u.week} currency={u.currency} />
        <Period title="This month" p={u.month} currency={u.currency} />
      </div>
      {u.budget.exceeded && (
        <p className="text-sm text-warning">
          Budget reached: {u.budget.reason}. Automatic AI polish is paused; Reels are still made with the rule-based editor.
        </p>
      )}
      {cfg.data && <BudgetForm key={`${u.budget.daily}-${u.budget.monthly}-${u.budget.override}`} daily={u.budget.daily} monthly={u.budget.monthly}
                                override={u.budget.override} currency={u.currency}
                                onSaved={() => { qc.invalidateQueries({ queryKey: ["ai-usage"] }); qc.invalidateQueries({ queryKey: ["ai-config"] }); }} />}
      <p className="text-xs text-muted">
        Costs are estimates from the prices in AI_MODEL_PRICES (backend <code>.env</code>). A model without a price shows “not priced”. Local Ollama calls cost nothing.
      </p>
    </div>
  );
}

function BudgetForm({ daily, monthly, override, currency, onSaved }: { daily: number; monthly: number; override: boolean; currency: string; onSaved: () => void }) {
  const [d, setD] = useState(String(daily || ""));
  const [m, setM] = useState(String(monthly || ""));
  const [o, setO] = useState(override);
  const save = useMutation({
    mutationFn: () => api.saveAiConfig({ dailyBudget: Number(d) || 0, monthlyBudget: Number(m) || 0, budgetOverride: o }),
    onSuccess: onSaved,
  });
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted">AI Budget per day ({currency}, empty = no limit)</span>
        <input aria-label="Daily AI budget" inputMode="decimal" className={INPUT} value={d} onChange={(e) => setD(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted">AI Budget per month ({currency})</span>
        <input aria-label="Monthly AI budget" inputMode="decimal" className={INPUT} value={m} onChange={(e) => setM(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm" title="Keep running automatic AI after a budget is used up">
        <input type="checkbox" aria-label="Override budget" checked={o} onChange={(e) => setO(e.target.checked)} /> Override
      </label>
      <button type="button" className={btnSecondary} disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save budget"}
      </button>
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
    </div>
  );
}

export function AiSettingsSection({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <Card>
        <AiProviderCard />
      </Card>
      {children}
      <Card>
        <AiUsageCard />
      </Card>
    </>
  );
}
