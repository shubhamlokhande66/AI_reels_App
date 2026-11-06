"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, Heading, Input, Select, Spinner, Toggle } from "@/components/atoms";
import { ErrorBanner, Field } from "@/components/molecules";
import type { AiConfig, AiConfigInput, AiProviderId, AiTestResult, AiUsagePeriod } from "@/types/api";

/** LOCAL AI = nothing leaves this computer. CLOUD AI = compact metadata and a few small keyframes are sent. */
export function AiModeBadge({ local, provider, className = "" }: { local: boolean; provider?: string | null; className?: string }) {
  return (
    <span title={local ? "Local AI: no media leaves this computer." : "Cloud AI: only compact analysis data and a few small keyframes are sent, never whole videos."}
      className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-bold tracking-wide", local ? "border-success/40 bg-success/10 text-success" : "border-accent/50 bg-accent/10 text-accent", className)}>
      {local ? "LOCAL AI" : "CLOUD AI"}
      {provider ? <span className="font-normal text-muted">· {provider}</span> : null}
    </span>
  );
}

/** ● Connected / ● Unavailable */
export const Live = ({ ok, on = "Connected", off = "Unavailable" }: { ok: boolean; on?: string; off?: string }) => (
  <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-semibold", ok ? "text-success" : "text-danger")}><span className={cn("h-2 w-2 rounded-full", ok ? "bg-success" : "bg-danger")} />{ok ? on : off}</span>
);

function TestResult({ r }: { r: AiTestResult }) {
  const tone = r.ok ? (r.correct ? "border-success/40 text-success" : "border-warning/50 text-warning") : "border-danger/40 text-danger";
  return (
    <div role="status" aria-label="AI test result" className={cn("rounded-xl border bg-surface-2/60 p-3 text-sm", tone)}>
      <p className="m-0 font-bold">
        {r.provider}
        {r.model ? ` · ${r.model}` : ""}
        {r.vision ? " (vision)" : ""}: {r.ok ? "connected" : "failed"} · {(r.latencyMs / 1000).toFixed(1)}s
      </p>
      <p className="m-0 mt-1 text-xs text-muted">{r.detail}{r.at ? ` · tested ${r.at.replace("T", " ")}` : ""}</p>
    </div>
  );
}

/** A model field: a dropdown of what the provider lists, with a free-text fallback for any other model name. */
function ModelField({ label, value, onChange, provider, allowEmpty }: { label: string; value: string; onChange: (v: string) => void; provider: AiProviderId; allowEmpty?: string }) {
  const q = useQuery({ queryKey: ["ai-provider-models", provider], queryFn: () => api.aiProviderModels(provider), staleTime: 60_000 });
  const names = q.data?.models.map((m) => m.name) ?? [];
  const [typing, setTyping] = useState(false); // only when the user asks to type a name the provider did not list
  return (
    <Field label={label} hint={q.data && !q.data.reachable ? `Could not list models: ${q.data.detail}` : undefined}>
      {typing || names.length === 0 ? (
        <Input aria-label={label} value={value} placeholder={allowEmpty ?? "model name"} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Select aria-label={label} value={value} onChange={(e) => (e.target.value === "__other" ? setTyping(true) : onChange(e.target.value))}>
          {allowEmpty && <option value="">{allowEmpty}</option>}
          {!value && !allowEmpty && <option value="">Choose a model…</option>}
          {value && !names.includes(value) && <option value={value}>{value} (configured)</option>}
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="__other">Other (type a name)…</option>
        </Select>
      )}
    </Field>
  );
}

export function AiProviderCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai-config"], queryFn: api.aiConfig });
  if (q.isLoading) return <Spinner size="sm" label="Loading AI settings…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const cfg = q.data;
  // keyed by what is saved, so the form always starts from the settings actually in use
  const key = JSON.stringify([cfg.provider, cfg.visionProvider, cfg.fallbackEnabled, cfg.fallbackProvider, cfg.providers]);
  return <ProviderForm key={key} cfg={cfg} onSaved={(c) => { qc.setQueryData(["ai-config"], c); qc.invalidateQueries({ queryKey: ["health"] }); }} />;
}

const KEY_NAME: Record<string, string> = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", claude: "ANTHROPIC_API_KEY" };

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
  const [separateVision, setSeparateVision] = useState(!!visionProvider);

  const save = useMutation({ meta: { success: "Saved", errorShown: true },
    mutationFn: () => {
      const vp = separateVision ? visionProvider : "";
      const body: AiConfigInput = {
        provider, textProvider: "", visionProvider: vp, fallbackEnabled, fallbackProvider,
        models: { [provider]: models[provider], ...(vp ? { [vp]: models[vp] } : {}) },
      };
      return api.saveAiConfig(body);
    },
    onSuccess: onSaved,
  });
  const test = useMutation({ meta: { errorShown: true }, mutationFn: (vision: boolean) => api.testAi(provider, vision), onSuccess: setResult });
  const p = byId[provider];
  const vp = separateVision && visionProvider ? byId[visionProvider] : null;
  const needsKey = (id: AiProviderId) => !byId[id].local && !byId[id].keyConfigured;
  const setModel = (id: string, field: "text" | "vision", v: string) => setModels((m) => ({ ...m, [id]: { ...m[id], [field]: v } }));

  return (
    <div className="flex flex-col gap-4">
      {/* the main provider */}
      <Card as="section" aria-label="Main AI" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Heading size="section" as="h3" className="flex-1 text-[14px]">Main AI</Heading>
          <AiModeBadge local={cfg.mode === "local"} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="AI Provider" className="sm:col-span-2">
            <Select aria-label="AI Provider" value={provider} onChange={(e) => setProvider(e.target.value as AiProviderId)}>
              {cfg.providers.map((x) => <option key={x.id} value={x.id}>{x.label}{x.local ? " (local)" : x.keyConfigured ? " (cloud)" : " (no API key)"}</option>)}
            </Select>
          </Field>
          <ModelField key={`t-${provider}`} label="Text Model" provider={provider} value={models[provider].text} onChange={(v) => setModel(provider, "text", v)} />
          {!separateVision && (
            <ModelField key={`v-${provider}`} label="Vision Model" provider={provider} value={models[provider].vision} allowEmpty="Same as the text model" onChange={(v) => setModel(provider, "vision", v)} />
          )}
        </div>
        {needsKey(provider) && (
          <p className="m-0 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
            {p.label} has no API key on the server. Add {KEY_NAME[provider] ?? "the API key"} to the backend <code>.env</code> file and restart the backend. Keys are never entered or shown in the browser.
          </p>
        )}
      </Card>

      {/* vision from another provider */}
      <Card as="section" aria-label="Vision" className="flex flex-col gap-3">
        <Toggle label="Use a different provider for vision (clip understanding)" on={separateVision} onChange={setSeparateVision} />
        {separateVision && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vision provider">
              <Select aria-label="Vision provider" value={visionProvider} onChange={(e) => setVisionProvider(e.target.value as AiProviderId | "")}>
                <option value="">Same as the AI provider</option>
                {cfg.providers.filter((x) => x.id !== provider).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </Select>
            </Field>
            {visionProvider && (
              <ModelField key={`vp-${visionProvider}`} label="Vision Model" provider={visionProvider} value={models[visionProvider].vision || models[visionProvider].text} onChange={(v) => setModel(visionProvider, "vision", v)} />
            )}
          </div>
        )}
        {vp && needsKey(vp.id as AiProviderId) && <p className="m-0 text-[12.5px] text-warning">{vp.label} has no API key on the server.</p>}
        <p className="m-0 text-[12px] text-muted">
          Vision sends at most {cfg.vision.maxFramesPerClip} distinct frames per clip, {cfg.vision.maxImageSize}px, detail “{cfg.vision.detail}”. Whole videos are never uploaded.
        </p>
      </Card>

      {/* fallback */}
      <Card as="section" aria-label="Fallback" className="flex flex-col gap-3">
        <Toggle label="Enable fallback" hint="Used only when the main provider is down, times out or is out of quota" on={fallbackEnabled} onChange={setFallbackEnabled} />
        <Field label="Fallback Provider">
          <Select aria-label="Fallback Provider" value={fallbackProvider} disabled={!fallbackEnabled} onChange={(e) => setFallbackProvider(e.target.value as AiProviderId | "")}>
            <option value="">None</option>
            {cfg.providers.filter((x) => x.id !== provider).map((x) => <option key={x.id} value={x.id}>{x.label}{needsKey(x.id) ? " (no API key)" : ""}</option>)}
          </Select>
        </Field>
      </Card>

      {/* now connected */}
      <Card as="section" aria-label="Connection" className="flex flex-col gap-3">
        <Heading size="section" as="h3" className="text-[14px]">Connection</Heading>
        <div className="grid gap-2 sm:grid-cols-2">
          {([["Text", cfg.status.text], ["Vision", cfg.status.vision]] as const).map(([label, s]) => (
            <div key={label} className="flex flex-col gap-1 rounded-xl border border-border bg-surface-2/50 p-3">
              <span className="text-[12px] font-semibold text-muted">{label}</span>
              <b className="truncate text-[13.5px]">{s.provider}{s.model ? ` · ${s.model}` : ""}</b>
              <Live ok={s.available} />
              {!s.available && s.detail && <span className="text-[11.5px] text-muted">{s.detail}</span>}
            </div>
          ))}
        </div>
        {test.error && <ErrorBanner message={errorMessage(test.error)} />}
        {result && <TestResult r={result} />}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[12px] text-muted">Save first, then test: a test uses the saved settings, sends one tiny request and changes nothing.</span>
        <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate(false)}>{test.isPending ? "Testing…" : "Test Connection"}</Button>
        <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate(true)}>Test vision</Button>
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
    </div>
  );
}

export function money(v: number | null | undefined, currency: string) {
  if (v === null || v === undefined) return "not priced";
  return `${currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `}${v.toFixed(v < 1 ? 4 : 2)}`;
}

/** the AI's kinds of work, in plain words */
const TASK_NAME: Record<string, string> = { shot_ranking: "Picking shots (and Match a Reel's Style)", studio_director: "AI director (pace, plan, New mix)", studio_captions: "Captions", translate: "Caption translation", general: "Other" };
function Period({ title, p, currency }: { title: string; p: AiUsagePeriod; currency: string }) {
  return (
    <Card className="flex flex-col gap-2 p-3 md:p-3">
      <span className="text-[12px] font-semibold text-muted">{title}</span>
      <b className="font-[family-name:var(--font-display)] text-[22px] leading-none">{p.calls} calls</b>
      <span className="text-[12px]">
        <span className="text-success">{p.ok} ok</span> · <span className={p.failed ? "text-danger" : "text-muted"}>{p.failed} failed</span>
        {p.fallbacks ? <span className="text-warning"> · {p.fallbacks} fallback</span> : null}
      </span>
      <span className="text-[12.5px] font-semibold">Estimated cost: {money(p.cost, currency)}{!p.allPriced && p.calls ? " (some models not priced)" : ""}</span>
      {p.tasks && p.tasks.length > 0 && (
        <div className="flex flex-col divide-y divide-border border-t border-border text-[12px]">
          {p.tasks.map((t) => (
            <div key={t.task} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate">{TASK_NAME[t.task] ?? t.task}</span>
              <span className="shrink-0 text-muted">{t.calls} · {money(t.cost, currency)}</span>
            </div>
          ))}
        </div>
      )}
      {p.providers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.providers.map((x) => <Badge key={x.provider}>{x.provider}: {x.calls}{x.failed ? ` (${x.failed} failed)` : ""} · {money(x.cost, currency)}</Badge>)}
        </div>
      )}
    </Card>
  );
}

export function AiUsageCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai-usage"], queryFn: api.aiUsage, refetchInterval: 60_000 });
  const cfg = useQuery({ queryKey: ["ai-config"], queryFn: api.aiConfig });
  if (q.isLoading) return <Spinner size="sm" label="Loading AI usage…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const u = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Period title="Today" p={u.today} currency={u.currency} />
        <Period title="This week" p={u.week} currency={u.currency} />
        <Period title="This month" p={u.month} currency={u.currency} />
      </div>
      {cfg.data && <BudgetForm key={`${u.budget.daily}-${u.budget.monthly}-${u.budget.override}`} daily={u.budget.daily} monthly={u.budget.monthly} override={u.budget.override} currency={u.currency}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["ai-usage"] }); qc.invalidateQueries({ queryKey: ["ai-config"] }); }} />}
      <p className="m-0 text-[12px] text-muted">Costs are estimates from the prices in AI_MODEL_PRICES (backend <code>.env</code>). A model without a price shows “not priced”. Local Ollama calls cost nothing.</p>
    </div>
  );
}

function BudgetForm({ daily, monthly, override, currency, onSaved }: { daily: number; monthly: number; override: boolean; currency: string; onSaved: () => void }) {
  const [d, setD] = useState(String(daily || ""));
  const [m, setM] = useState(String(monthly || ""));
  const [o, setO] = useState(override);
  const save = useMutation({ meta: { success: "Saved", errorShown: true }, mutationFn: () => api.saveAiConfig({ dailyBudget: Number(d) || 0, monthlyBudget: Number(m) || 0, budgetOverride: o }), onSuccess: onSaved });
  return (
    <Card as="section" aria-label="Budget" className="flex flex-col gap-3">
      <Heading size="section" as="h3" className="text-[14px]">Budget</Heading>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`AI Budget per day (${currency}, empty = no limit)`}><Input aria-label="Daily AI budget" inputMode="decimal" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <Field label={`AI Budget per month (${currency})`}><Input aria-label="Monthly AI budget" inputMode="decimal" value={m} onChange={(e) => setM(e.target.value)} /></Field>
      </div>
      <Toggle label="Override" hint="Keep running automatic AI after a budget is used up" on={o} onChange={setO} />
      <div className="flex justify-end"><Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>Save budget</Button></div>
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
    </Card>
  );
}
