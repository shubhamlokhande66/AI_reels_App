"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api, errorMessage } from "@/lib/api";
import { btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { useHealth } from "@/hooks/useApi";
import { AiSettingsSection } from "@/components/AiSettings";
import type { AiModels, ModelTestResult } from "@/types/api";

function Row({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <li className="flex items-center justify-between py-2 text-sm">
      <span>{label}</span>
      <span className={ok ? "text-success" : "text-danger"}>
        {ok ? "● Available" : "● Unavailable"}
        {detail && <span className="ml-2 text-muted">{detail}</span>}
      </span>
    </li>
  );
}

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
  if (q.isLoading) return <Spinner label="Looking for installed models…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  // keyed by the saved choice so the dropdown always starts on what is actually in use
  return <PickerBody key={q.data.current} data={q.data} onSaved={(d) => qc.setQueryData(["ai-models"], d)} />;
}

function PickerBody({ data, onSaved }: { data: AiModels; onSaved: (d: AiModels) => void }) {
  const [pick, setPick] = useState(data.current);
  const [results, setResults] = useState<Record<string, ModelTestResult>>({});
  const save = useMutation({ mutationFn: (m: string | null) => api.chooseModel(m), onSuccess: onSaved });
  const test = useMutation({
    mutationFn: (m: string) => api.testModel(m),
    onSuccess: (r) => setResults((cur) => ({ ...cur, [r.model]: r })),
  });
  const chosen = data.models.find((m) => m.name === pick);
  const usable = data.models.filter((m) => !m.embeddingOnly);
  const result = results[pick];

  if (!data.reachable) {
    return <ErrorBanner title="Ollama is not reachable" message={data.detail ?? "Start Ollama, then reload this page."} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Model used for scripts, hooks, change requests, content analysis and Library search</span>
          <select
            aria-label="AI model"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm outline-none focus:border-accent"
          >
            {usable.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} · {m.sizeGb} GB{m.vision ? " · vision" : ""}{m.thinking ? " · reasoning" : ""}{m.current ? " (in use)" : ""}
              </option>
            ))}
            {!usable.some((m) => m.name === pick) && <option value={pick}>{pick || "No model chosen"}</option>}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="button" className={btnPrimary} disabled={save.isPending || pick === data.current} onClick={() => save.mutate(pick)}>
            {save.isPending ? "Saving…" : "Use this model"}
          </button>
          <button type="button" className={btnSecondary} disabled={test.isPending || !pick} onClick={() => test.mutate(pick)}>
            {test.isPending ? "Testing…" : "Test it"}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted">
        In use now: <strong className="text-foreground">{data.current || "none"}</strong>{" "}
        {data.source === "settings" ? "(chosen here)" : data.source === "env" ? "(from OLLAMA_MODEL in .env)" : ""}.
        {data.source === "settings" && (
          <>
            {" "}
            <button type="button" className="text-accent hover:underline" disabled={save.isPending} onClick={() => save.mutate(null)}>
              Go back to the .env model{data.envModel ? ` (${data.envModel})` : ""}
            </button>
          </>
        )}
      </p>
      {chosen && !chosen.vision && <p className="text-xs text-warning">{data.needsVision} This model does not report vision, so those features will not work with it.</p>}
      {chosen?.thinking && <p className="text-xs text-muted">This model can reason step by step; the app turns that off for structured answers because it makes them much slower.</p>}
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
      {test.error && <ErrorBanner message={errorMessage(test.error)} />}

      {result && (
        <div role="status" aria-label="Model test result" className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
          <p className={`font-medium ${VERDICT[result.verdict].tone}`}>
            {result.model}: {VERDICT[result.verdict].label} · {result.seconds}s
          </p>
          <p className="mt-1 text-xs text-muted">{result.detail}</p>
        </div>
      )}
      <p className="text-xs text-muted">
        The test asks the model to interpret one small edit request and checks its answer. It changes nothing. Speed depends on your computer, so compare models here rather
        than trusting a general ranking. Install more with <code>ollama pull &lt;name&gt;</code>.
      </p>
    </div>
  );
}

function OllamaModels() {
  // The Ollama picker is only useful when Ollama serves text or vision; it never assumes Ollama exists otherwise.
  const cfg = useQuery({ queryKey: ["ai-config"], queryFn: api.aiConfig });
  if (!cfg.data || (cfg.data.textProvider !== "ollama" && cfg.data.visionProvider !== "ollama")) return null;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Ollama model (on this computer)</h2>
      <ModelPicker />
    </Card>
  );
}

export default function SettingsPage() {
  const { data, isLoading, error } = useHealth();
  return (
    <>
      <PageHeader title="Settings" subtitle="System status, the AI provider and AI usage. API keys stay in the backend .env file." />
      {isLoading && <Spinner />}
      {error && <ErrorBanner title="Backend unreachable" message={`Could not reach ${API_URL}. Start the API server and reload.`} />}
      {data && (
        <div className="space-y-6">
          <Card>
            <ul className="divide-y divide-border">
              <Row label="MongoDB" ok={data.mongodb} />
              <Row label="FFmpeg" ok={data.ffmpeg} />
              <Row label={`AI (${data.ai.provider})`} ok={data.ai.available} detail={`${data.ai.model ?? ""} ${data.ai.detail}`.trim()} />
            </ul>
            <p className="mt-4 text-xs text-muted" suppressHydrationWarning>API: {API_URL}</p>
          </Card>
          <AiSettingsSection>
            <OllamaModels />
          </AiSettingsSection>
        </div>
      )}
    </>
  );
}
