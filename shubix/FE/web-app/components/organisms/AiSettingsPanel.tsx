"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, Heading, Icon, Select, Spinner } from "@/components/atoms";
import { ErrorBanner, Field, SidePanel } from "@/components/molecules";
import { useHealth } from "@/hooks/useApi";
import { AiModeBadge, AiProviderCard, AiUsageCard, Live, money } from "@/components/organisms/AiSettings";
import { AiDirectorReport } from "@/components/organisms/AiDirectorReport";
import type { AiModels, ModelTestResult } from "@/types/api";

const VERDICT: Record<ModelTestResult["verdict"], { label: string; tone: string }> = {
  correct: { label: "Understood the request exactly", tone: "text-success" },
  "over-eager": { label: "Added actions nobody asked for", tone: "text-warning" },
  wrong: { label: "Misunderstood the request", tone: "text-danger" },
  failed: { label: "Did not answer", tone: "text-danger" },
};

/** Choose which local model the AI features use, and test how a model behaves on this computer. */
function ModelPicker() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai-models"], queryFn: api.aiModels });
  if (q.isLoading) return <Spinner size="sm" label="Looking for installed models…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  // keyed by the saved choice so the dropdown always starts on what is actually in use
  return <PickerBody key={q.data.current} data={q.data} onSaved={(d) => qc.setQueryData(["ai-models"], d)} />;
}

function PickerBody({ data, onSaved }: { data: AiModels; onSaved: (d: AiModels) => void }) {
  const [pick, setPick] = useState(data.current);
  const [results, setResults] = useState<Record<string, ModelTestResult>>({});
  const save = useMutation({ meta: { success: "Saved", errorShown: true }, mutationFn: (m: string | null) => api.chooseModel(m), onSuccess: onSaved });
  const test = useMutation({ meta: { errorShown: true }, mutationFn: (m: string) => api.testModel(m), onSuccess: (r) => setResults((cur) => ({ ...cur, [r.model]: r })) });
  const chosen = data.models.find((m) => m.name === pick);
  const usable = data.models.filter((m) => !m.embeddingOnly);
  const result = results[pick];
  if (!data.reachable) return <ErrorBanner title="Ollama is not reachable" message={data.detail ?? "Start Ollama, then reload this page."} />;

  return (
    <Card as="section" aria-label="Ollama model" className="flex flex-col gap-3">
      <Field label="Model used for scripts, hooks, change requests, content analysis and Library search">
        <Select aria-label="AI model" value={pick} onChange={(e) => setPick(e.target.value)}>
          {usable.map((m) => <option key={m.name} value={m.name}>{m.name} · {m.sizeGb} GB{m.vision ? " · vision" : ""}{m.thinking ? " · reasoning" : ""}{m.current ? " (in use)" : ""}</option>)}
          {!usable.some((m) => m.name === pick) && <option value={pick}>{pick || "No model chosen"}</option>}
        </Select>
      </Field>
      <p className="m-0 text-[12.5px] text-muted">
        In use now: <strong className="text-foreground">{data.current || "none"}</strong>{" "}
        {data.source === "settings" ? "(chosen here)" : data.source === "env" ? "(from OLLAMA_MODEL in .env)" : ""}.
        {data.source === "settings" && <> <button type="button" className="font-semibold text-accent hover:underline" disabled={save.isPending} onClick={() => save.mutate(null)}>Go back to the .env model{data.envModel ? ` (${data.envModel})` : ""}</button></>}
      </p>
      {chosen && !chosen.vision && <p className="m-0 text-[12.5px] text-warning">{data.needsVision} This model does not report vision, so those features will not work with it.</p>}
      {chosen?.thinking && <p className="m-0 text-[12.5px] text-muted">This model can reason step by step; the app turns that off for structured answers because it makes them much slower.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={test.isPending || !pick} onClick={() => test.mutate(pick)}>{test.isPending ? "Testing…" : "Test it"}</Button>
        <Button disabled={save.isPending || pick === data.current} onClick={() => save.mutate(pick)}>{save.isPending ? "Saving…" : "Use this model"}</Button>
      </div>
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
      {test.error && <ErrorBanner message={errorMessage(test.error)} />}
      {result && (
        <div role="status" aria-label="Model test result" className="rounded-xl border border-border bg-surface-2/60 p-3 text-sm">
          <p className={cn("m-0 font-bold", VERDICT[result.verdict].tone)}>{result.model}: {VERDICT[result.verdict].label} · {result.seconds}s</p>
          <p className="m-0 mt-1 text-xs text-muted">{result.detail}</p>
        </div>
      )}
      <p className="m-0 text-[12px] text-muted">The test asks the model to interpret one small edit request and checks its answer; it changes nothing. Speed depends on this computer, so compare models here. Install more with <code>ollama pull &lt;name&gt;</code>.</p>
    </Card>
  );
}

type Id = "provider" | "ollama" | "usage" | "director";

/** Admin → Tools → AI settings (also /settings): the AI's state at a glance, then its sections (like the CMS); a tap
 * opens a section's form on the right: the provider and models, the Ollama model, usage and budget, the AI director. */
export function AiSettingsPanel() {
  const health = useHealth();
  const cfg = useQuery({ queryKey: ["ai-config"], queryFn: api.aiConfig });
  const usage = useQuery({ queryKey: ["ai-usage"], queryFn: api.aiUsage, refetchInterval: 60_000 });
  const report = useQuery({ queryKey: ["ai-director-report"], queryFn: api.aiDirectorReport });
  const [open, setOpen] = useState<Id | null>(null);

  if (health.isLoading) return <Spinner />;
  if (health.error) return <ErrorBanner title="Backend unreachable" message={`We couldn't reach ${API_URL || "the server"}. Start the server, then try again.`} onRetry={() => location.reload()} />;
  const c = cfg.data, u = usage.data, h = health.data;
  const ollama = !!c && (c.textProvider === "ollama" || c.visionProvider === "ollama");

  const sections: { id: Id; icon: string; title: string; line: string; badge?: React.ReactNode; body: React.ReactNode }[] = [
    { id: "provider", icon: "wand", title: "AI provider & models", line: c ? `Text: ${c.status.text.provider}${c.status.text.model ? ` · ${c.status.text.model}` : ""} · Vision: ${c.status.vision.provider}${c.fallbackEnabled && c.fallbackProvider ? ` · fallback ${c.fallbackProvider}` : ""}` : "Which AI does each job",
      badge: c ? <AiModeBadge local={c.mode === "local"} /> : undefined, body: <AiProviderCard /> },
    ...(ollama ? [{ id: "ollama" as const, icon: "gear", title: "Ollama model (on this computer)", line: "Pick and test the local model", body: <ModelPicker /> }] : []),
    { id: "usage", icon: "coins", title: "Usage & budget", line: u ? `Today ${u.today.calls} calls · this month ${u.month.calls} calls, ${money(u.month.cost, u.currency)}${u.budget.daily || u.budget.monthly ? " · budget set" : " · no budget"}` : "Calls, cost and budget",
      badge: u?.budget.exceeded ? <Badge tone="danger">Budget used up</Badge> : undefined, body: <AiUsageCard /> },
    { id: "director", icon: "sparkle", title: "AI director report", line: report.data ? `${report.data.plans} Reels planned · ${report.data.creators} people · last ${report.data.days} days` : "How often people kept what the AI chose",
      body: <AiDirectorReport bare /> },
  ];
  const cur = sections.find((s) => s.id === open);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* the state at a glance */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="flex flex-col gap-1.5 p-3 md:p-3"><span className="text-[12px] font-semibold text-muted">Database</span><b className="text-[14px]">MongoDB</b><Live ok={!!h?.mongodb} on="Connected" /></Card>
        <Card className="flex flex-col gap-1.5 p-3 md:p-3"><span className="text-[12px] font-semibold text-muted">Text AI</span><b className="truncate text-[14px]">{c ? `${c.status.text.provider}${c.status.text.model ? ` · ${c.status.text.model}` : ""}` : h?.ai.provider}</b><Live ok={c ? c.status.text.available : !!h?.ai.available} /></Card>
        <Card className="flex flex-col gap-1.5 p-3 md:p-3"><span className="text-[12px] font-semibold text-muted">Vision AI</span><b className="truncate text-[14px]">{c ? `${c.status.vision.provider}${c.status.vision.model ? ` · ${c.status.vision.model}` : ""}` : "…"}</b><Live ok={!!c?.status.vision.available} /></Card>
        <Card className="flex flex-col gap-1.5 p-3 md:p-3"><span className="text-[12px] font-semibold text-muted">This month</span><b className="font-[family-name:var(--font-display)] text-[20px] leading-none">{u ? money(u.month.cost, u.currency) : "…"}</b><span className="text-[12px] text-muted">{u ? `${u.month.calls} AI calls` : ""}</span></Card>
      </div>
      {u?.budget.exceeded && (
        <p className="m-0 flex items-center gap-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-[13px] font-semibold text-warning">
          <Icon name="warn" size={16} />Budget reached: {u.budget.reason}. Automatic AI polish is paused; Reels are still made with the rule-based editor.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {sections.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpen(s.id)} aria-haspopup="dialog"
            className={cn("flex w-full items-center gap-3 rounded-2xl border bg-surface px-4 py-3.5 text-left shadow-[var(--shadow)] transition-colors md:px-5", open === s.id ? "border-accent" : "border-border hover:border-accent/60")}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name={s.icon} size={19} /></span>
            <span className="min-w-0 flex-1">
              <Heading size="section" as="h2">{s.title}</Heading>
              <span className="block truncate text-[12.5px] text-muted">{s.line}</span>
            </span>
            {s.badge}
            <Icon name="chevron" size={18} className="shrink-0 text-muted" />
          </button>
        ))}
      </div>
      {API_URL && <p className="m-0 text-xs text-muted" suppressHydrationWarning>API: {API_URL}</p>}

      <SidePanel open={!!cur} onClose={() => setOpen(null)} title={cur?.title ?? ""} where="AI settings" badge={cur?.badge}>
        {cur?.body}
      </SidePanel>
    </div>
  );
}
