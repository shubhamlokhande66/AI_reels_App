"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import type { ReviseResult } from "@/types/api";
import { btnPrimary } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

const IDEAS = [
  "Make it shorter",
  "More energy",
  "Make it calmer with longer shots",
  "Remove the first clip",
  "Make it 20 seconds",
  "Add captions",
  "Smoother transitions",
  "Louder music",
  "Use the luxury style",
  "Show a different order",
  "Change the hook",
  "Use the drop for the product reveal",
  "Show the product earlier",
];

interface Props {
  projectId: string;
  busy: boolean;
  /** Pre-fill the box (e.g. a prompt typed on the create page) instead of starting empty. */
  initialText?: string;
  /** Run that pre-filled text once, automatically, as soon as this Reel is ready — for "type a prompt, get an edited
   * Reel" in one flow. Still asks for confirmation if the AI has to interpret part of it, same as typing it by hand. */
  autoRun?: boolean;
}

/** Tell the app what to change in plain words, then Regenerate. Every change becomes a new version. */
export function ReviseBox({ projectId, busy, initialText, autoRun }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState(initialText ?? "");
  const [result, setResult] = useState<{ data: ReviseResult; applied: boolean; sent: string } | null>(null);
  const autoRan = useRef(false);
  const [showAll, setShowAll] = useState(false);

  const run = useMutation({
    mutationFn: (v: { dryRun: boolean; confirm?: { sent: string; actions: Record<string, unknown>[] } }) => {
      const sent = v.confirm?.sent ?? text.trim();
      const call = v.confirm ? api.revise(projectId, sent, v.dryRun, v.confirm.actions) : api.revise(projectId, sent, v.dryRun);
      return call.then((data) => ({ data, applied: !v.dryRun && !data.needsConfirmation, sent }));
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.applied && r.data.job) {
        setText("");
        qc.invalidateQueries({ queryKey: keys.project(projectId) });
        qc.invalidateQueries({ queryKey: keys.renderings(projectId) });
        qc.invalidateQueries({ queryKey: keys.timeline(projectId) });
      }
    },
  });
  const disabled = busy || run.isPending;
  const can = text.trim().length >= 2 && !disabled;
  const add = (idea: string) => setText((t) => (t.trim() ? `${t.trim().replace(/[.,]$/, "")}, ${idea.toLowerCase()}` : idea));

  useEffect(() => {
    if (autoRun && !autoRan.current && !busy && (initialText ?? "").trim().length >= 2) {
      autoRan.current = true;
      run.mutate({ dryRun: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, busy, initialText]);

  return (
    <section className="card" aria-label="Change this Reel">
      <span className="h2">Change this Reel</span>
      <textarea
        aria-label="What should change?"
        maxLength={3000}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Faster at the start, more close-ups, louder music"
        className="ta"
        style={{ minHeight: 70 }}
      />
      <div className="between flex-wrap">
        <div className="chips min-w-0 flex-1" aria-label="Ideas">
          {(showAll ? IDEAS : IDEAS.slice(0, 2)).map((i) => (
            <button key={i} type="button" disabled={disabled} onClick={() => add(i)} className="chip">
              {i}
            </button>
          ))}
          <button type="button" className="chip mu" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Fewer ideas" : "More ideas"}
          </button>
        </div>
        <button type="button" className="btn g sm" disabled={!can} onClick={() => run.mutate({ dryRun: false })}>
          {run.isPending ? "Working…" : busy ? "Rendering…" : "Apply"}
        </button>
      </div>
      <span className="mu xs">
        You get a new version and the old one is kept. Short, direct instructions work best: we change your own clips (order, speed, cuts,
        captions, music, style); we don&apos;t create new footage.{" "}
        <button type="button" className="ac font-bold disabled:opacity-50" disabled={!can} onClick={() => run.mutate({ dryRun: true })}>
          Preview what changes
        </button>
      </span>
      {run.error && <ErrorBanner message={errorMessage(run.error)} />}
      {result && (
        <Outcome
          data={result.data}
          applied={result.applied}
          busy={disabled}
          onConfirm={() => run.mutate({ dryRun: false, confirm: { sent: result.sent, actions: result.data.actions } })}
        />
      )}
    </section>
  );
}

function Outcome({ data, applied, busy, onConfirm }: { data: ReviseResult; applied: boolean; busy: boolean; onConfirm: () => void }) {
  const nothing = data.mode === "none";
  return (
    <div role="status" aria-label="What I understood" className="space-y-3 rounded-xl border border-border bg-surface-2 p-3 text-sm">
      {data.understood.length > 0 && (
        <div>
          <p className="mb-1 font-medium">
            {nothing ? "I understood, but there was nothing to change:" : applied ? "Changing:" : data.needsConfirmation ? "I think you mean:" : "This would:"}
          </p>
          <ul className="space-y-1">
            {data.understood.map((u, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span aria-hidden>✓</span>
                <span>{u.does}</span>
                {u.source === "ai" && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">AI-interpreted</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.needsConfirmation && (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
          <p className="text-xs">
            The AI model interpreted part of your request. It can be wrong, so nothing has been changed yet. Check the list above, then apply.
          </p>
          <button type="button" className={btnPrimary} disabled={busy} onClick={onConfirm}>
            Apply these changes
          </button>
        </div>
      )}
      {data.mode === "edit" && applied && <p className="text-xs text-muted">Your current edit was adjusted and is rendering as a new version. Undo is available in the editor.</p>}
      {data.mode === "rebuild" && <p className="text-xs text-muted">This needs a fresh edit from your clips. {applied ? "It is rendering now as a new version." : ""}</p>}
      {data.warnings.map((w) => (
        <p key={w} className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          {w}
        </p>
      ))}
      {data.notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          ℹ {n}
        </p>
      ))}
      {data.notUnderstood.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-warning">I did not understand:</p>
          <ul className="list-inside list-disc text-muted">
            {data.notUnderstood.map((n) => (
              <li key={n}>&ldquo;{n}&rdquo;</li>
            ))}
          </ul>
          {data.aiNote && <p className="mt-1 text-xs text-muted">{data.aiNote}</p>}
          {nothing && data.understood.length === 0 && (
            <p className="mt-2 text-xs text-muted">Nothing was changed. Try wording like: {data.examples.slice(0, 5).join(" · ")}.</p>
          )}
        </div>
      )}
    </div>
  );
}
