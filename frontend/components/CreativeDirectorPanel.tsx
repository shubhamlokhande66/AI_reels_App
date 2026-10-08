"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import type { Concept, CreativePlan, GenerateOptions, HookOption, Project, ProjectBrief, Scorecard } from "@/types/api";
import { btnPrimary, btnSecondary, Card, ErrorBanner } from "./ui";

const CONCEPTS: { id: Exclude<Concept, "auto">; label: string; blurb: string }[] = [
  { id: "viral", label: "Viral", blurb: "Strongest hook first, fast cuts on the hits, the biggest moment on the drop." },
  { id: "cinematic", label: "Cinematic", blurb: "A story in order: shots breathe across phrases, slow pushes, a held ending." },
  { id: "premium", label: "Premium", blurb: "Product and brand first: close-ups, the reveal on the drop, a hero ending." },
];
const SCORES: [keyof Scorecard, string][] = [
  ["hook", "Hook"], ["story", "Story"], ["pacing", "Pacing"], ["musicSync", "Music sync"], ["visualQuality", "Visual quality"],
  ["brandFit", "Brand fit"], ["textReadability", "Text"], ["audio", "Audio"], ["ending", "Ending"], ["retention", "Retention"],
];
const tone = (s: number) => (s >= 80 ? "bg-success" : s >= 60 ? "bg-warning" : "bg-danger");
const pretty = (s: string) => s.replace(/_/g, " ");

function Steps({ project }: { project: Project }) {
  const plan = project.reelPlan;
  const done = [
    project.videos.length > 0 && !!project.audio,
    !!project.timeline,
    !!plan?.creativePlan,
    project.status === "completed",
    !!plan?.scorecard,
  ];
  const names = ["Upload", "AI analysis", "Creative concept", "Generate", "AI review", "Tell the director"];
  return (
    <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Creative Director steps">
      {names.map((n, i) => (
        <li
          key={n}
          className={`rounded-full border px-2.5 py-1 ${done[i] ? "border-success/50 bg-success/10 text-success" : "border-border text-muted"}`}
        >
          {done[i] ? "✓ " : `${i + 1}. `}
          {n}
        </li>
      ))}
    </ol>
  );
}

function Brief({ brief }: { brief: ProjectBrief }) {
  const guess = (k: string) => (brief.inferred.includes(k) ? <span className="text-muted"> (guessed)</span> : null);
  const rows: [string, string, string][] = [
    ["Platform", pretty(brief.platform), "platform"], ["Objective", pretty(brief.objective), "objective"],
    ["Audience", pretty(brief.audience), "audience"], ["Style", pretty(brief.style), "style"], ["Tone", brief.tone, "tone"],
    ["Call to action", brief.cta || "none", "cta"], ["Brand", brief.brand || "none", "brand"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
      {rows.map(([label, value, key]) => (
        <div key={label}>
          <dt className="text-xs text-muted">{label}</dt>
          <dd>
            {value}
            {guess(key)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Plan({ plan }: { plan: CreativePlan }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-lg font-semibold">{plan.concept}</span>
        <span className="ml-2 text-xs text-muted">{plan.source === "ai" ? "decided by the AI director" : "planned by the rules"}</span>
      </p>
      {plan.logline && <p className="text-muted">{plan.logline}</p>}
      {plan.hook?.type && (
        <p>
          <span className="text-muted">Hook:</span> {pretty(plan.hook.type)}
          {plan.hook.asset ? ` · ${plan.hook.asset}` : ""}
          {plan.hook.why ? ` · ${plan.hook.why}` : ""}
        </p>
      )}
      {plan.story.length > 0 && (
        <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Story beats">
          {plan.story.map((b, i) => (
            <li key={`${b}-${i}`} className="rounded-md bg-surface-2 px-2 py-0.5">
              {i > 0 && <span className="mr-1 text-muted">→</span>}
              {pretty(b)}
            </li>
          ))}
        </ol>
      )}
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {([["Pacing", plan.pacing], ["Visual energy", plan.visualEnergy], ["Music", plan.musicInterpretation], ["Text", plan.textStrategy],
          ["Effects", plan.effectsStrategy], ["Transitions", plan.transitionStrategy], ["Ending", plan.ending]] as const)
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd>{pretty(v)}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function Hooks({ hooks }: { hooks: HookOption[] }) {
  return (
    <ol className="space-y-1 text-sm" aria-label="Possible openings">
      {hooks.map((h, i) => (
        <li key={`${h.clipId}-${h.start}-${h.type}`} className="flex flex-wrap items-baseline gap-x-2">
          <span className="w-5 text-muted">{i + 1}.</span>
          <span className="font-medium">{pretty(h.type)}</span>
          <span className="text-muted">
            {h.asset} {h.start.toFixed(1)}–{h.end.toFixed(1)}s
          </span>
          <span className="tabular-nums">score {Math.round(h.hookScore * 100)}</span>
          <span className="text-xs text-muted">
            clarity {Math.round(h.clarity * 100)} · curiosity {Math.round(h.curiosity * 100)} · visual {Math.round(h.visualStrength * 100)}
          </span>
          {h.text && <span className="text-xs">“{h.text}”</span>}
        </li>
      ))}
    </ol>
  );
}

export function ScorecardView({ card, rounds }: { card: Scorecard; rounds?: NonNullable<Project["reelPlan"]>["selfCorrection"] }) {
  return (
    <div className="space-y-3" aria-label="AI review">
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">{card.overallScore}</span>
        <span className="text-sm text-muted">/ 100 overall{card.measured ? "" : " (rendered file not measured)"}</span>
      </p>
      <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {SCORES.map(([k, label]) => {
          const v = card[k] as number;
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0 text-muted">{label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span className={`block h-full ${tone(v)}`} style={{ width: `${v}%` }} />
              </span>
              <span className="w-8 text-right tabular-nums">{v}</span>
            </div>
          );
        })}
      </div>
      {card.issues.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted">
          {card.issues.map((i) => (
            <li key={i}>• {i}</li>
          ))}
        </ul>
      )}
      {rounds && rounds.length > 0 && (
        <ul className="space-y-0.5 text-sm">
          {rounds.map((r) => (
            <li key={r.iteration}>
              {r.kept ? "✎" : "↺"} Correction {r.iteration}: {r.scoreBefore} → {r.scoreAfter ?? "–"}
              {r.kept ? " (kept)" : " (not better, discarded)"}
              {r.changes.length > 0 ? ` · ${r.changes.join("; ")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Phase 2: the Creative Director workflow — brief, concept, three versions, hooks, the review score card. */
export function CreativeDirectorPanel({ project, busy, onGenerate, guard = (run) => run() }: {
  project: Project;
  busy: boolean;
  onGenerate: (o: GenerateOptions) => void;
  guard?: (run: () => void) => void; // the footage check before anything is generated
}) {
  const qc = useQueryClient();
  const plan = project.reelPlan;
  const versions = useMutation({
    mutationFn: () => api.variations(project.id, CONCEPTS.map((c) => c.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.project(project.id) }),
  });
  const current = plan?.creativePlan?.direction ?? project.settings.concept ?? "auto";
  return (
    <section className="mt-6 space-y-4" aria-label="Creative Director">
      <Steps project={project} />
      {plan?.brief && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Brief</h2>
          <Brief brief={plan.brief} />
        </Card>
      )}
      {plan?.creativePlan && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Creative concept</h2>
          <Plan plan={plan.creativePlan} />
        </Card>
      )}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Concepts</h2>
          <button type="button" className={btnPrimary} disabled={busy || versions.isPending} onClick={() => guard(() => versions.mutate())}>
            {versions.isPending ? "Starting…" : "Make all 3 versions"}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {CONCEPTS.map((c) => (
            <div key={c.id} className={`rounded-xl border p-3 ${current === c.id ? "border-accent" : "border-border"}`}>
              <p className="font-medium">{c.label}</p>
              <p className="mt-1 text-xs text-muted">{c.blurb}</p>
              <button
                type="button"
                className={`${btnSecondary} mt-2`}
                disabled={busy}
                onClick={() => onGenerate({ concept: c.id, label: `Concept: ${c.label}` })}
              >
                {current === c.id ? "Regenerate" : "Generate this one"}
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          With AI on, each concept is planned separately (its own hook, pacing, shot order, music reading, text and effects).
        </p>
        {versions.error && <ErrorBanner message={errorMessage(versions.error)} />}
      </Card>
      {plan?.hooks && plan.hooks.length > 0 && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Possible openings</h2>
          <Hooks hooks={plan.hooks} />
        </Card>
      )}
      {plan?.scorecard && (
        <Card className="space-y-2">
          <h2 className="font-semibold">AI review</h2>
          <ScorecardView card={plan.scorecard} rounds={plan.selfCorrection} />
          {plan.review && plan.review.iterations.some((r) => r.kept) && (
            <ul className="space-y-0.5 text-sm" aria-label="Improved before rendering">
              {plan.review.iterations
                .filter((r) => r.kept)
                .map((r) => (
                  <li key={r.round}>
                    ✎ Before rendering, round {r.round} ({r.scoreBefore} → {r.scoreAfter}): {r.changes.join("; ")}
                  </li>
                ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            Scores are measured from the edit and the rendered file. Tell the director what to change below, e.g. “Make it more
            premium”, “Change the hook”, “Make it 15 seconds”.
          </p>
        </Card>
      )}
    </section>
  );
}
