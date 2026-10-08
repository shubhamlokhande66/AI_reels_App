"use client";

import { assetUrl } from "@/lib/api";
import { checkFootage, type FootageCheck } from "@/lib/footage";
import { formatDuration } from "@/lib/format";
import type { Media, Project } from "@/types/api";
import { Card } from "./ui";

/** What each analysis flag means, in plain words. ``block`` = the clip cannot be used as it is. */
export const FLAG_TEXT: Record<string, { text: string; block?: boolean }> = {
  too_dark: { text: "too dark to use", block: true },
  too_blurry: { text: "too blurry to use", block: true },
  too_short: { text: "shorter than 1 second", block: true },
  low_resolution: { text: "low resolution: may look soft on a phone" },
  shaky: { text: "shaky: steadier parts are preferred" },
  duplicate_heavy: { text: "mostly frozen or repeated frames" },
  wrong_orientation: { text: "landscape: it will be cropped to 9:16" },
};

export interface ClipCheckResult {
  blocked: Media[]; // clips that cannot be used: remove (or replace) them
  footage: FootageCheck; // usable footage vs the Reel length
  passed: boolean;
}

/** The step-1 verdict on the project's analysed clips for a Reel of ``seconds``. */
export function clipCheck(project: Project, seconds: number, talk = false): ClipCheckResult {
  const live = project.videos.filter((v) => !v.purged);
  const blocked = live.filter((v) => v.analysis && !v.analysis.usable);
  // good footage as measured by the analysis (dark, blurry and shaky parts do not count); the file length before it
  const footage = checkFootage(live.filter((v) => !v.analysis || v.analysis.usable).map((v) => v.analysis?.goodSeconds ?? v.duration), seconds);
  // talking to camera: the Reel is as long as the speech (the length is only the maximum), so footage cannot run short
  const f = talk ? { ...footage, ok: true } : footage;
  return { blocked, footage: f, passed: live.length > 0 && blocked.length === 0 && f.ok };
}

/** Every clip with its checks: ✓ usable, ⚠ usable with a warning, ✗ cannot be used (with a Remove button). */
export function ClipCheckPanel({ project, result, onRemove, busy }: {
  project: Project;
  result: ClipCheckResult;
  onRemove: (mediaId: string) => void;
  busy: boolean;
}) {
  const live = project.videos.filter((v) => !v.purged);
  const dupes = (project.analysis?.warnings ?? []).filter((w) => /duplicate|same|identical/i.test(w));
  return (
    <Card className="space-y-3" >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Clip check</h3>
        <span className={`text-sm ${result.passed ? "text-success" : "text-warning"}`}>
          {result.passed ? "✓ All checks passed" : "Fix the items marked ✗ to continue"}
        </span>
      </div>
      <ul className="space-y-2 text-sm" aria-label="Checked clips">
        {live.map((v) => {
          const a = v.analysis;
          const flags = (a?.flags ?? []).map((f) => FLAG_TEXT[f]).filter(Boolean);
          const bad = !!a && !a.usable;
          const warn = !bad && flags.length > 0;
          return (
            <li key={v.id} className="flex items-center gap-3">
              {v.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl(v.thumbnailUrl)} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
              )}
              <span className={`w-5 shrink-0 text-center ${bad ? "text-danger" : warn ? "text-warning" : "text-success"}`} aria-hidden>
                {bad ? "✗" : warn ? "⚠" : "✓"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">{v.name}</p>
                <p className="text-xs text-muted">
                  {formatDuration(v.duration)}
                  {a?.goodSeconds != null && v.duration != null && a.goodSeconds < v.duration - 0.3 ? ` · good part ${a.goodSeconds.toFixed(1)}s` : ""}
                  {a ? ` · quality ${Math.round(a.qualityScore * 100)}%` : " · not analysed"}
                  {flags.length > 0 ? ` · ${flags.map((f) => f.text).join(" · ")}` : ""}
                  {bad && !flags.some((f) => f.block) ? " · no usable part (dark, blurry or too small)" : ""}
                </p>
              </div>
              {bad && (
                <button type="button" className="text-xs text-danger hover:underline disabled:opacity-50" disabled={busy} onClick={() => onRemove(v.id)}>
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {dupes.length > 0 && <p className="text-xs text-muted">{dupes.join(" ")}</p>}
      <p className={`text-sm ${result.footage.ok ? "text-muted" : "text-warning"}`}>
        {result.footage.ok ? "✓" : "✗"} About {Math.round(result.footage.footage)}s of good footage; a {result.footage.reel}s Reel needs about{" "}
        {Math.ceil(result.footage.needed)}s{result.footage.ok ? "." : ` (about ${Math.ceil(result.footage.needed - result.footage.footage)}s more), so the editor can pick the best moments without slowing shots down or repeating them.`}
      </p>
    </Card>
  );
}
