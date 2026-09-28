"use client";

import type { QualityReport } from "@/types/api";
import { btnPrimary, btnSecondary } from "../ui";

interface Props {
  report: QualityReport | null;
  checking: boolean;
  fixing: string | null;
  onCheck: () => void;
  onFix: (code: string, segmentId: string | null) => void;
  error?: string | null;
}

const ICON = { error: "⛔", warning: "⚠️", info: "ℹ️" } as const;

/** AI Quality Check: problems found before export, each with a one-click, undoable fix when one exists. */
export function QualityPanel({ report, checking, fixing, onCheck, onFix, error }: Props) {
  return (
    <section aria-label="Quality check" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Quality check</h3>
        <button type="button" className={btnSecondary} disabled={checking} onClick={onCheck}>
          {checking ? "Checking…" : report ? "Check again" : "Run quality check"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {report && report.issues.length === 0 && (
        <p role="status" className="text-sm text-success">
          ✓ No problems found{report.checked.kind ? ` in the ${report.checked.kind} render and the timeline` : " in the timeline"}.
        </p>
      )}
      {report && !report.checked.renderingId && (
        <p className="text-xs text-muted">Only the timeline was checked. Render a preview to also check black frames, audio and length in the actual video.</p>
      )}
      {report && report.issues.length > 0 && (
        <ul className="space-y-2">
          {report.issues.map((i, n) => (
            <li key={`${i.code}-${i.segmentId ?? n}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
              <span>
                <span aria-hidden>{ICON[i.severity]} </span>
                <span className="sr-only">{i.severity}: </span>
                {i.message}
              </span>
              {i.fix ? (
                <button type="button" className={btnPrimary} disabled={fixing !== null} onClick={() => onFix(i.code, i.segmentId)}>
                  {fixing === i.code ? "Fixing…" : `Auto Fix: ${i.fix}`}
                </button>
              ) : (
                <span className="text-xs text-muted">needs your review</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
