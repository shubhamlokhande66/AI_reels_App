"use client";

import type { AiDirectorLog, CreativeReview, HookCandidate, ReelPlan } from "@/types/api";
import { Card } from "./ui";

const CATEGORY_LABELS: Record<string, string> = {
  hook: "Hook", pacing: "Pacing", story: "Story", diversity: "Variety", beat: "On the beat", visual: "Picture quality",
  transitions: "Transitions", motion: "Motion flow", ending: "Ending", text: "Text",
};
const SEVERITY_TONE: Record<string, string> = { high: "text-danger", medium: "text-warning", low: "text-muted" };
const scoreTone = (s: number) => (s >= 80 ? "text-success" : s >= 60 ? "text-warning" : "text-danger");

/** The Quality Reviewer's verdict: a score, what it measured, what it fixed before rendering, and what is left. */
export function CreativeReviewCard({ review }: { review: CreativeReview }) {
  const kept = review.iterations.filter((r) => r.kept);
  return (
    <section aria-label="Quality review">
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-medium">Quality review</h3>
        <span className={`text-2xl font-semibold tabular-nums ${scoreTone(review.overallScore)}`}>{review.overallScore}</span>
        <span className="text-sm text-muted">/ 100 (target {review.target})</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
        {Object.entries(review.categories).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <span className="text-muted">{CATEGORY_LABELS[k] ?? k}</span>
            <span className={`tabular-nums ${scoreTone(v)}`}>{v}</span>
          </div>
        ))}
      </div>
      {kept.length > 0 && (
        <div className="text-sm">
          <p className="text-muted">Improved before rendering:</p>
          <ul className="mt-1 space-y-0.5">
            {kept.map((r) => (
              <li key={r.round}>
                ✎ Round {r.round} ({r.scoreBefore} → {r.scoreAfter}): {r.changes.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.iterations.some((r) => !r.kept) && (
        <p className="text-xs text-muted">A further revision did not improve the score, so it was not used.</p>
      )}
      {review.issues.length === 0 ? (
        <p className="text-sm text-success">✓ No problems found.</p>
      ) : (
        <ul aria-label="Remaining issues" className="space-y-1 text-sm">
          {review.issues.map((i) => (
            <li key={`${i.timestamp}-${i.problem}`} className="flex gap-2">
              <span className={`w-14 shrink-0 tabular-nums ${SEVERITY_TONE[i.severity]}`}>{i.timestamp.toFixed(1)}s</span>
              <span>
                {i.problem} <span className={`text-xs ${SEVERITY_TONE[i.severity]}`}>({i.severity})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
    </section>
  );
}

function HookCandidates({ hooks, chosen }: { hooks: HookCandidate[]; chosen: string }) {
  return (
    <div className="text-sm">
      <p className="text-muted">Openings compared:</p>
      <ol className="mt-1 space-y-0.5">
        {hooks.map((h, i) => (
          <li key={h.clipId}>
            {i + 1}. {h.asset} {h.asset === chosen && <span className="text-success">(used)</span>}{" "}
            <span className="text-muted">
              · score {Math.round(h.score * 100)} · {h.reason}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const LEVEL_TONE: Record<number, string> = {
  1: "bg-slate-400/20 text-slate-200",
  2: "bg-blue-400/20 text-blue-200",
  3: "bg-amber-400/20 text-amber-200",
  4: "bg-rose-400/20 text-rose-200",
};
const ENERGY_TONE: Record<string, string> = { low: "bg-slate-500/30", medium: "bg-blue-500/40", high: "bg-amber-500/50", very_high: "bg-rose-500/60" };
const pretty = (s: string) => s.replace(/_/g, " ");
const time = (t: number) => t.toFixed(2);

/** Every decision the director made for an edited Reel: the story, the music it followed, each shot, and the checks it ran. */
export function ReelPlanPanel({ plan, stale }: { plan: ReelPlan; stale?: boolean }) {
  const fixed = plan.quality.filter((c) => c.fixed).length;
  const failed = plan.quality.filter((c) => !c.ok);
  const m = plan.music;
  const category =
    plan.category.source === "none"
      ? "not determined (turn on AI assist so the vision model can look at your clips)"
      : `${plan.category.name} (${plan.category.source === "vision" ? "from what the clips show" : "from the style you chose"}, ${Math.round(plan.category.confidence * 100)}% sure)`;
  const limits = [...plan.limits, ...m.notDetected.map((n) => `Not detected: ${n}.`)].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <section aria-label="Director's plan" className="mt-10 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Director&apos;s plan</h2>
        <p className="text-sm text-muted">
          {plan.shots.length} shots over {plan.duration.toFixed(1)}s · {plan.format} · {Math.round(m.bpm)} BPM · {m.bars.length} bars · {m.drops.length} drop{m.drops.length === 1 ? "" : "s"}
          {m.pauses.length > 0 ? ` · ${m.pauses.length} pause${m.pauses.length === 1 ? "" : "s"}` : ""}
        </p>
        {stale && <p className="mt-1 text-sm text-warning">You have edited the timeline since this plan was made, so some rows may be out of date. Generate again for a fresh plan.</p>}
      </div>

      <Card className="space-y-2 text-sm">
        <p>
          <span className="text-muted">Content: </span>
          {category}
        </p>
        <p>
          <span className="text-muted">Hook: </span>
          {plan.hook.kind}: {plan.hook.asset}, {time(plan.hook.start)}–{time(plan.hook.end)}s
        </p>
        {plan.hookCandidates && plan.hookCandidates.length > 1 && <HookCandidates hooks={plan.hookCandidates} chosen={plan.hook.asset} />}
        {plan.heroMoment && (
          <p>
            <span className="text-muted">Strongest moment: </span>
            {plan.heroMoment.asset}, {time(plan.heroMoment.start)}–{time(plan.heroMoment.end)}s{" "}
            <span className="text-muted">(kept for the music&apos;s peak)</span>
          </p>
        )}
        <p>
          <span className="text-muted">Ending: </span>
          {plan.ending.purpose}: {plan.ending.asset}
        </p>
        {plan.story.map((s) => (
          <p key={s} className="text-muted">
            ✦ {s}
          </p>
        ))}
        <div aria-label="Music energy" className="flex h-3 overflow-hidden rounded-full">
          {m.energyCurve.map((e) => (
            <div
              key={`${e.start}-${e.level}`}
              title={`${time(e.start)}–${time(e.end)}s: ${pretty(e.level)}`}
              className={ENERGY_TONE[e.level] ?? "bg-slate-500/30"}
              style={{ width: `${((e.end - e.start) / plan.duration) * 100}%` }}
            />
          ))}
        </div>
        <p className="text-xs text-muted">Song energy across the Reel: dark = quiet, red = very high.</p>
        {m.sections && m.sections.length > 0 && (
          <div aria-label="Song parts" className="flex overflow-hidden rounded-md border border-border text-[11px]">
            {m.sections.map((s) => (
              <div
                key={`${s.start}-${s.label}`}
                title={`${pretty(s.label)} ${time(s.start)}–${time(s.end)}s · cuts on ${s.cutOn}${s.vocal >= 0.35 ? " · vocals" : ""}`}
                className="truncate border-r border-border px-1 py-0.5 last:border-r-0"
                style={{ width: `${((s.end - s.start) / plan.duration) * 100}%` }}
              >
                {s.label}
                {s.vocal >= 0.35 ? " ♪" : ""}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Purpose</th>
              <th className="px-3 py-2">Shows</th>
              <th className="px-3 py-2">Camera</th>
              <th className="px-3 py-2">Transition</th>
              <th className="px-3 py-2">Music event</th>
              <th className="px-3 py-2">Text</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {plan.shots.map((s) => (
              <tr key={s.index}>
                <td className="px-3 py-2 tabular-nums text-muted">{s.index}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {time(s.start)}–{time(s.end)}
                </td>
                <td className="px-3 py-2">
                  {s.purpose}
                  {s.why && <span className="mt-0.5 block max-w-[20rem] text-xs text-muted">{s.why}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className="block max-w-[16rem] truncate" title={s.subject}>
                    {s.subject === "not analysed" ? <span className="text-muted">not analysed</span> : s.subject}
                  </span>
                  <span className="text-xs text-muted">
                    {s.asset}
                    {s.speed !== 1 ? ` · ${s.speed}x` : ""}
                  </span>
                </td>
                <td className="px-3 py-2">{s.camera}</td>
                <td className="px-3 py-2">{s.transition === "cut" ? <span className="text-muted">cut</span> : pretty(s.transition)}</td>
                <td className="px-3 py-2">
                  <span title={s.mayTrigger} className={`rounded-full px-2 py-0.5 text-[11px] ${LEVEL_TONE[s.beatLevel]}`}>
                    {s.beatLevelName}
                  </span>{" "}
                  <span className="text-xs text-muted">{s.musicEvent}</span>
                </td>
                <td className="px-3 py-2">{s.text ? `“${s.text}”` : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.review && <CreativeReviewCard review={plan.review} />}

      {plan.aiDirector && <AiDirectorSection log={plan.aiDirector} />}
      {!plan.aiDirector && plan.directorFallback && (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <strong className="font-medium">The AI director did not plan this Reel.</strong> It was made by the rule-based editor instead
          ({plan.directorFallback.reason}). Generate again to ask the AI for a new plan.
        </div>
      )}

      <Card className="space-y-2">
        <h3 className="font-medium">
          Quality check{" "}
          <span className="text-sm font-normal text-muted">
            {plan.quality.length - failed.length} of {plan.quality.length} passed{fixed > 0 ? ` · ${fixed} repaired before rendering` : ""}
          </span>
        </h3>
        <ul className="space-y-1 text-sm">
          {plan.quality.map((c) => (
            <li key={c.name} className="flex gap-2">
              <span aria-label={c.ok ? (c.fixed ? "repaired" : "passed") : "failed"} className={c.ok ? "text-success" : "text-danger"}>
                {c.ok ? (c.fixed ? "✎" : "✓") : "✗"}
              </span>
              <span>
                {c.name}
                {c.detail && <span className="text-muted"> · {c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <ul aria-label="What this plan does not do" className="space-y-1 text-xs text-muted">
        {limits.map((l) => (
          <li key={l}>• {l}</li>
        ))}
      </ul>
    </section>
  );
}

const NAMES: Record<string, string> = { gemini: "Gemini", openai: "OpenAI", ollama: "Ollama", claude: "Claude" };

/** What the AI director decided for every shot, next to what was actually used (the safety layer may repair values). */
export function AiDirectorSection({ log }: { log: AiDirectorLog }) {
  const changed = log.shots.filter((s) => s.changes.length > 0).length;
  const snapped = log.shots.filter((s) => s.timing).length;
  // "Crash Zoom" / "crash-zoom" / "crash_zoom" are the same choice (whitespace and dashes become "_")
  const same = (a: string, b: string) => a.trim().toLowerCase().replace(/[\s-]+/g, "_") === b;
  return (
    <section aria-label="What the AI decided" className="space-y-3">
      <div>
        <h3 className="font-medium">What the AI decided</h3>
        <p className="text-sm text-muted">
          {NAMES[log.provider] ?? log.provider}
          {log.model ? ` · ${log.model}` : ""}
          {log.reused ? " · plan reused from an earlier render (no new AI call)" : log.latencyMs !== null ? ` · answered in ${(log.latencyMs / 1000).toFixed(1)}s` : ""}
          {log.tokens?.input ? ` · ${log.tokens.input} tokens in, ${log.tokens.output ?? "?"} out` : ""}
          {" · "}
          {changed === 0 ? "every shot used as the AI asked" : `${changed} of ${log.shots.length} shots corrected by the safety check`}
          {snapped > 0 ? ` · ${snapped} cut${snapped === 1 ? "" : "s"} fine-tuned onto the beat` : ""}
          {log.revision ? ` · the AI revised its own plan (${log.revision.before} → ${log.revision.after} problems${log.revision.used ? "" : ", first plan kept"})` : ""}
        </p>
      </div>
      <Card className="space-y-1 text-sm">
        {log.idea && (
          <p>
            <span className="text-muted">Creative idea: </span>
            {log.idea}
          </p>
        )}
        <p>
          <span className="text-muted">Style: </span>
          {log.style.asked}
          {log.style.used !== log.style.asked && <span className="text-warning"> → kept {log.style.used}</span>}
          <span className="text-muted"> · Colour grade: </span>
          {log.grade.asked || "none"}
          {log.grade.used !== log.grade.asked && <span className="text-warning"> → {log.grade.used ?? "style default"}</span>}
        </p>
        {log.texts.used.length > 0 && (
          <p>
            <span className="text-muted">On-screen text: </span>
            {log.texts.used.map((t) => `“${t.text}” (${t.role}, ${t.start.toFixed(1)}–${t.end.toFixed(1)}s)`).join(" · ")}
          </p>
        )}
      </Card>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table aria-label="AI shot decisions" className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Cut at</th>
              <th className="px-3 py-2">Clip (moment used)</th>
              <th className="px-3 py-2">Purpose</th>
              <th className="px-3 py-2">Effect</th>
              <th className="px-3 py-2">Transition in</th>
              <th className="px-3 py-2">Speed</th>
              <th className="px-3 py-2">Safety check</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {log.shots.map((s) => (
              <tr key={s.shot}>
                <td className="px-3 py-2 tabular-nums text-muted">{s.shot}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {s.used.start.toFixed(2)}–{s.used.end.toFixed(2)}s
                  {s.beatAlignment !== "free" && <span className="block text-xs text-muted">on a {s.beatAlignment === "strong" ? "strong beat" : "beat"}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className="block max-w-[14rem] truncate" title={s.clip}>{s.clip}</span>
                  <span className="text-xs text-muted">{s.used.from.toFixed(1)}–{s.used.to.toFixed(1)}s of the clip</span>
                </td>
                <td className="px-3 py-2">{s.purpose}</td>
                <td className="px-3 py-2">
                  {pretty(s.used.effect)}
                  {!same(s.asked.effect, s.used.effect) && <span className="block text-xs text-warning">asked: {s.asked.effect}</span>}
                </td>
                <td className="px-3 py-2">
                  {s.used.transition === "cut" ? <span className="text-muted">cut</span> : `${pretty(s.used.transition)} ${s.used.transitionSeconds}s`}
                  {!same(s.asked.transition, s.used.transition) && <span className="block text-xs text-warning">asked: {s.asked.transition}</span>}
                </td>
                <td className="px-3 py-2 tabular-nums">{s.used.speed}x</td>
                <td className="px-3 py-2 text-xs">
                  {s.changes.length === 0 ? <span className="text-success">✓ as asked</span> : (
                    <ul className="space-y-0.5 text-warning">
                      {s.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                  {s.timing && <span className="mt-0.5 block text-muted">♪ {s.timing}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {log.fixes.length > 0 && (
        <ul aria-label="Safety check notes" className="space-y-1 text-xs text-muted">
          {log.fixes.map((x) => (
            <li key={x}>✎ {x}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
