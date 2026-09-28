"use client";

import type { ProductPlan, ProductShot } from "@/types/api";
import { Card } from "./ui";

const PURPOSE_TONE: Record<ProductShot["purpose"], string> = {
  hook: "bg-fuchsia-400/20 text-fuchsia-200",
  curiosity: "bg-violet-400/20 text-violet-200",
  reveal: "bg-blue-400/20 text-blue-200",
  hero: "bg-emerald-400/20 text-emerald-200",
  detail: "bg-amber-400/20 text-amber-200",
  macro: "bg-orange-400/20 text-orange-200",
  payoff: "bg-cyan-400/20 text-cyan-200",
  cta: "bg-rose-400/20 text-rose-200",
};

const pretty = (s: string) => s.replace(/_/g, " ");
const time = (t: number) => t.toFixed(2);

/** The director's plan, in plain words: every micro-shot, planned before a single frame was made. */
export function ShotList({ plan }: { plan: ProductPlan }) {
  const passed = plan.quality.filter((c) => c.ok).length;
  return (
    <section aria-label="Director's shot list" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Director&apos;s shot list</h2>
        <p className="text-sm text-muted">
          {plan.shots.length} micro-shots over {plan.duration.toFixed(1)}s at {plan.bpm ? `${Math.round(plan.bpm)} BPM` : "a steady rhythm"}. Every cut lands on a beat.
        </p>
      </div>

      {Object.keys(plan.concept).length > 0 && (
        <Card className="space-y-1 text-sm">
          {plan.concept.hook && (
            <p>
              <span className="text-muted">Hook: </span>
              {plan.concept.hook}
            </p>
          )}
          {plan.concept.story && (
            <p>
              <span className="text-muted">Story: </span>
              {plan.concept.story}
            </p>
          )}
          {plan.concept.ending && (
            <p>
              <span className="text-muted">Ending: </span>
              {plan.concept.ending}
            </p>
          )}
        </Card>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Purpose</th>
              <th className="px-3 py-2">Shot &amp; camera</th>
              <th className="px-3 py-2">Transition in</th>
              <th className="px-3 py-2">Effects</th>
              <th className="px-3 py-2">Text</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {plan.shots.map((s) => {
              const texts = plan.texts.filter((t) => t.start < s.end - 0.01 && t.end > s.start + 0.01);
              return (
                <tr key={s.index} title={s.note}>
                  <td className="px-3 py-2 tabular-nums text-muted">{s.index + 1}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {time(s.start)}–{time(s.end)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] uppercase ${PURPOSE_TONE[s.purpose]}`}>{s.purpose}</span>
                  </td>
                  <td className="px-3 py-2">
                    {pretty(s.framing)} <span className="text-muted">· {pretty(s.camera.type)}</span>
                    {s.camera.start.roll !== 0 || s.camera.end.roll !== 0 ? <span className="text-muted"> · micro sway</span> : null}
                  </td>
                  <td className="px-3 py-2">{s.transitionIn.type === "cut" ? <span className="text-muted">cut</span> : pretty(s.transitionIn.type)}</td>
                  <td className="px-3 py-2">
                    {s.effects.length === 0 ? <span className="text-muted">none</span> : s.effects.map((e) => pretty(e.type)).join(", ")}
                  </td>
                  <td className="px-3 py-2">{texts.map((t) => `“${t.text}”`).join(" ") || <span className="text-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Card className="space-y-2">
        <h3 className="font-medium">
          Quality check{" "}
          <span className="text-sm font-normal text-muted">
            {passed} of {plan.quality.length} passed
          </span>
        </h3>
        <ul className="space-y-1 text-sm">
          {plan.quality.map((c) => (
            <li key={c.name} className="flex gap-2">
              <span aria-label={c.ok ? "passed" : "failed"} className={c.ok ? "text-success" : "text-danger"}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span>
                {c.name}
                {c.detail && <span className="text-muted"> · {c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {plan.warnings.length > 0 && (
        <ul aria-label="Warnings" className="space-y-1 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          {plan.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {plan.notes.length > 0 && (
        <ul aria-label="Notes" className="space-y-1 text-sm text-muted">
          {plan.notes.map((n) => (
            <li key={n}>✦ {n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
