"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { SongAnalysis as SongAnalysisData, SongAnalysisEvent } from "@/types/api";
import { beatTime } from "@/components/organisms/BeatMap";
import { btnSecondary } from "@/components/atoms";

const SHOWN = 40; // events listed on the page; the full list is in the JSON

function when(e: SongAnalysisEvent): string {
  return e.time_sec !== null ? beatTime(e.time_sec) : `${beatTime(e.start_sec ?? 0)} – ${beatTime(e.end_sec ?? 0)}`;
}

function save(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The song analysis document (librosa), as measured: tempo, beats, onsets, events, silences, changes. */
export function SongAnalysis({ projectId, data }: { projectId: string; data: SongAnalysisData }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = data.candidate_events.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }), {});

  async function downloadFull() {
    setBusy(true);
    setError(null);
    try {
      save("song-analysis-full.json", await api.songAnalysis(projectId, true, true)); // every measurement, every frame and onset
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (data.status === "failed") {
    return <p className="text-sm text-red-500">The song analysis failed: {data.errors.join("; ")}</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Song analysis (librosa)</h3>
          <p className="text-xs text-muted">
            Schema {data.schema_version} · {data.tempo.bpm} BPM (or {data.tempo.alternative_bpm}) · {data.beats.length} beats ·{" "}
            {data.beats.filter((b) => b.downbeat).length} bar starts · {data.candidate_events.length} events · {data.audio.duration_sec}s
          </p>
        </div>
        <button type="button" className={btnSecondary} onClick={() => save("song-analysis.json", data)}>Download JSON</button>
        <button type="button" className="text-xs text-muted hover:underline" disabled={busy} onClick={() => void downloadFull()}>
          {busy ? "Preparing…" : "Full internal data"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {data.errors.length > 0 && <p className="text-xs text-muted">Note: {data.errors.join("; ")}</p>}
      {data.sections.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.sections.map((s, i) => (
            <span key={i} className="rounded-lg bg-surface px-2 py-1 text-[11px]">
              {s.type} {beatTime(s.start_sec)}–{beatTime(s.end_sec)} · {s.energy_level.replace("_", " ").toLowerCase()}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
          <span key={type} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{type} {n}</span>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border">
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Strength</th>
                <th className="px-3 py-2 font-medium">Confidence</th>

              </tr>
            </thead>
            <tbody>
              {data.candidate_events.slice(0, SHOWN).map((e, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-mono tabular-nums">{when(e)}</td>
                  <td className="px-3 py-1.5 font-medium">{e.type}</td>
                  <td className="px-3 py-1.5 tabular-nums">{e.strength ?? "-"}</td>
                  <td className="px-3 py-1.5 tabular-nums">{e.confidence ?? "-"}</td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {data.candidate_events.length > SHOWN && <p className="text-[11px] text-muted">First {SHOWN} of {data.candidate_events.length} events; all of them are in the JSON.</p>}
    </div>
  );
}
