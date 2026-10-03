"use client";

import type { InstagramCheck, InstagramReport as Report } from "@/types/api";
import { Card } from "./ui";

const MARK: Record<InstagramCheck["status"], { icon: string; tone: string; label: string }> = {
  pass: { icon: "✓", tone: "text-success", label: "passes" },
  warn: { icon: "!", tone: "text-warning", label: "could be better" },
  fail: { icon: "✕", tone: "text-danger", label: "fails" },
  info: { icon: "i", tone: "text-muted", label: "advice" },
};

function scoreTone(score: number | null): string {
  if (score === null) return "text-muted";
  return score >= 85 ? "text-success" : score >= 65 ? "text-warning" : "text-danger";
}

/** How a Reel made for Instagram scores against Instagram's ranking signals, with what to fix and how to post it. */
export function InstagramReport({ report, stale }: { report: Report; stale?: boolean }) {
  const order = report.signals.map((s) => s.id);
  const groups = order.map((id) => ({
    signal: report.signals.find((s) => s.id === id)!,
    checks: report.checks.filter((c) => c.signal === id),
  }));
  const info = report.checks.filter((c) => c.status === "info" && !order.includes(c.signal));
  const fixes = report.checks.filter((c) => (c.status === "fail" || c.status === "warn") && c.tip);

  return (
    <section aria-label="Instagram ranking check" className="mt-10 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Instagram ranking check</h2>
        <p className="text-sm text-muted">
          Instagram shows a new Reel to a small test audience, then to wider groups if they watch, rewatch and send it.
          This checks the Reel against the signals Instagram ranks on.
        </p>
        {stale && <p className="mt-1 text-sm text-warning">You have edited the timeline since this check. Generate again for a fresh one.</p>}
      </div>

      <Card className="flex flex-wrap items-center gap-6">
        <div aria-label={`Score ${report.score} out of 100`} className="text-center">
          <p className={`text-4xl font-bold ${scoreTone(report.score)}`}>{report.score}</p>
          <p className="text-xs text-muted">out of 100</p>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className={`font-medium ${report.blocked.length ? "text-danger" : ""}`}>{report.verdict}</p>
          <div className="flex flex-wrap gap-2">
            {report.signals.map((s) => (
              <span key={s.id} className="rounded-full border border-border px-2.5 py-0.5 text-xs">
                {s.label}: <span className={`font-medium ${scoreTone(s.score)}`}>{s.score ?? "–"}</span>
              </span>
            ))}
          </div>
        </div>
      </Card>

      {fixes.length > 0 && (
        <Card className="space-y-2 text-sm">
          <h3 className="font-medium">Fix before posting</h3>
          <ul className="space-y-1.5">
            {fixes.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span aria-hidden className={MARK[c.status].tone}>{MARK[c.status].icon}</span>
                <span>{c.tip}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(({ signal, checks }) => (
          <Card key={signal.id} className="space-y-2 text-sm">
            <h3 className="font-medium">{signal.label}</h3>
            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.id} className="flex gap-2" aria-label={`${c.name}: ${MARK[c.status].label}`}>
                  <span aria-hidden className={`w-4 shrink-0 text-center font-bold ${MARK[c.status].tone}`}>{MARK[c.status].icon}</span>
                  <span className="min-w-0">
                    {c.name}
                    {c.detail && <span className="block break-words text-xs text-muted">{c.detail}</span>}
                    {c.status === "info" && c.tip && <span className="block text-xs text-muted">{c.tip}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        {info.map((c) => (
          <Card key={c.id} className="text-sm">{c.name}: {c.tip}</Card>
        ))}
      </div>

      <Card className="space-y-2 text-sm">
        <h3 className="font-medium">When you post</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {report.postingTips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="pt-1 text-xs text-muted">{report.note}</p>
      </Card>
    </section>
  );
}
