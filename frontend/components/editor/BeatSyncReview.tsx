"use client";

import { checkCuts } from "@/lib/beats";
import type { EdlTimeline, ReelPlan } from "@/types/api";
import { btnPrimary, Card } from "../ui";

const time = (t: number) => t.toFixed(2);

/**
 * Its own tab: just the question "did the video split correctly on the music's beats?" — video + audio + the beat map,
 * with a plain checklist, before you touch any editing tool. Nothing here changes the Reel; it only shows what happened.
 */
export function BeatSyncReview({
  timeline: tl,
  music,
  musicStale,
  onContinue,
}: {
  timeline: EdlTimeline;
  music?: ReelPlan["music"];
  musicStale?: boolean;
  onContinue: () => void;
}) {
  const cutTimes = tl.segments.slice(1).map((s) => s.timelineStart);
  const checks = checkCuts(cutTimes, music);
  const onBeat = checks.filter((c) => c.onBeat).length;
  const allGood = music && checks.length > 0 && onBeat === checks.length;

  if (!music) {
    return (
      <Card className="space-y-2">
        <h3 className="font-medium">No beat map for this Reel yet</h3>
        <p className="text-sm text-muted">
          Generate this Reel from the Create screen (with a song attached) to get a beat map, then come back here to check that
          every cut lands on the music.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-1">
        <h3 className="font-medium">
          {checks.length === 0
            ? "Only one shot: nothing to check"
            : allGood
              ? `All ${checks.length} cuts are on the beat`
              : `${onBeat} of ${checks.length} cuts are on the beat`}
        </h3>
        <p className="text-sm text-muted">
          The video was split at {Math.round(tl.bpm)} BPM, on beats and real strong accents in your song. Check the list below;
          if a cut looks wrong, open a shot on the <span className="text-foreground">Edit &amp; transitions</span> tab and trim or move it.
        </p>
        {musicStale && (
          <p className="text-xs text-warning">This beat map is from an earlier version of the edit — it may not match your latest changes exactly.</p>
        )}
      </Card>

      {checks.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Cut at</th>
                <th className="px-3 py-2">Distance to nearest beat</th>
                <th className="px-3 py-2">On the beat?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {checks.map((c, i) => (
                <tr key={c.t}>
                  <td className="px-3 py-2 tabular-nums text-muted">{i + 1}</td>
                  <td className="px-3 py-2 tabular-nums">{time(c.t)}s</td>
                  <td className="px-3 py-2 tabular-nums">{Number.isFinite(c.offset) ? `${Math.round(c.offset * 1000)} ms` : "—"}</td>
                  <td className="px-3 py-2">
                    {c.onBeat ? (
                      <span className="text-success">✓ yes</span>
                    ) : (
                      <span className="text-warning">⚠ off by {Math.round(c.offset * 1000)} ms</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button type="button" className={btnPrimary} onClick={onContinue}>
        {allGood ? "Looks correct — go add transitions and effects" : "Continue to Edit & transitions anyway"}
      </button>
    </div>
  );
}
