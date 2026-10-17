"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/hooks/useApi";
import { btnDanger, btnSecondary, Card, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import type { DirectorProfile, FeedbackReason, Project } from "@/types/api";

const REASONS: { id: FeedbackReason; label: string }[] = [
  { id: "opening", label: "Weak opening" },
  { id: "pacing", label: "Pacing" },
  { id: "clips", label: "Wrong shots" },
  { id: "music", label: "Music sync" },
  { id: "effects", label: "Too many effects" },
  { id: "text", label: "Text" },
  { id: "other", label: "Something else" },
];

/** "Does this Reel work?": the person's verdict teaches their personal director profile (stored on this computer). */
export function DirectorFeedback({ project }: { project: Project }) {
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState<DirectorProfile | null>(null);
  const send = useMutation({
    mutationFn: (v: { verdict: "accepted" | "rejected"; reason?: FeedbackReason }) => api.feedback(project.id, v.verdict, v.reason, project.output?.id),
    onSuccess: (p) => {
      setSent(p);
      setAsking(false);
    },
  });
  return (
    <section className="card" aria-label="Director feedback">
      <div className="between">
        <span className="h2">Director feedback</span>
        <span className="mu sm">Teaches your style</span>
      </div>
      {sent ? (
        <span className="mu sm" role="status">
          Thanks! {sent.ready ? "Your style is learned and shapes the next Reels you leave on Auto." : `We need ${sent.minEvidence - sent.evidence} more answer${sent.minEvidence - sent.evidence === 1 ? "" : "s"} like this before it changes anything.`}
        </span>
      ) : (
        <>
          <span className="mu sm">{asking ? "What should be better?" : "How did this Reel turn out?"}</span>
          {!asking ? (
            <div className="g2">
              <button type="button" className="btn sm" disabled={send.isPending} onClick={() => send.mutate({ verdict: "accepted" })}>
                Love it
              </button>
              <button type="button" className="btn sm" disabled={send.isPending} onClick={() => setAsking(true)}>
                Needs work
              </button>
            </div>
          ) : (
            <div className="chips w" role="group" aria-label="What was wrong">
              {REASONS.map((r) => (
                <button key={r.id} type="button" className="chip" disabled={send.isPending} onClick={() => send.mutate({ verdict: "rejected", reason: r.id })}>
                  {r.label}
                </button>
              ))}
              <button type="button" className="chip mu" onClick={() => setAsking(false)}>
                Back
              </button>
            </div>
          )}
        </>
      )}
      {send.error && <ErrorBanner message={errorMessage(send.error)} />}
    </section>
  );
}

/** Privacy: delete this project's uploaded clips and music now. The finished Reels are kept. */
export function PurgeMediaButton({ project, busy }: { project: Project; busy: boolean }) {
  const qc = useQueryClient();
  const purge = useMutation({
    mutationFn: () => api.purgeMedia(project.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.project(project.id) }),
  });
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={btnDanger}
        disabled={busy || purge.isPending}
        onClick={() => {
          if (window.confirm("Delete the uploaded clips and music of this project? The finished Reels stay; a new version will need a new upload.")) {
            purge.mutate();
          }
        }}
      >
        Delete my uploads
      </button>
      {purge.data && <p className="text-sm text-muted" role="status">Deleted {purge.data.deleted} uploaded file{purge.data.deleted === 1 ? "" : "s"}.</p>}
      {purge.error && <ErrorBanner message={errorMessage(purge.error)} />}
    </div>
  );
}

const PREF_LABELS: Record<string, string> = {
  avgShotSeconds: "Average shot", duration: "Typical length", style: "Favourite mode", pace: "Pace", transitions: "Transitions",
  effects: "Effects", hook: "Opening", text: "On-screen text",
};

/** Settings: what the personal director has learned, with an off switch and a reset. */
export function DirectorProfileSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["director-profile"], queryFn: api.directorProfile });
  const set = (p: DirectorProfile) => qc.setQueryData(["director-profile"], p);
  const toggle = useMutation({ mutationFn: (on: boolean) => api.setDirectorProfile(on), onSuccess: set });
  const reset = useMutation({ mutationFn: api.resetDirectorProfile, onSuccess: set });
  if (q.isLoading) return <Spinner label="Loading your director profile…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const p = q.data;
  const prefs = Object.entries(p.preferences).filter(([, v]) => v !== null && v !== undefined && v !== "as styled");
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Your director profile</h2>
          <p className="text-sm text-muted">
            Learned from your feedback and edits, stored only on this computer. It adjusts what you leave on Auto (pace, transitions, effects,
            opening); it never overrides a choice you make.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" role="switch" checked={p.enabled} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)}
                 className="h-5 w-5 accent-[var(--accent)]" />
          Use it
        </label>
      </div>
      <p className="text-sm">
        {p.ready ? <span className="text-success">Active</span> : <span className="text-muted">Learning</span>} · {p.evidence} signal{p.evidence === 1 ? "" : "s"}
        {!p.ready && ` (needs ${p.minEvidence})`}
      </p>
      {prefs.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {prefs.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{PREF_LABELS[k] ?? k}</dt>
              <dd>{k === "avgShotSeconds" ? `${v}s` : k === "duration" ? `${v}s` : String(v).replace(/_/g, " ")}</dd>
            </div>
          ))}
        </dl>
      )}
      <button type="button" className={btnSecondary} disabled={reset.isPending || p.evidence === 0}
              onClick={() => window.confirm("Forget everything the director has learned?") && reset.mutate()}>
        Reset profile
      </button>
      {(toggle.error || reset.error) && <ErrorBanner message={errorMessage(toggle.error ?? reset.error)} />}
    </Card>
  );
}

