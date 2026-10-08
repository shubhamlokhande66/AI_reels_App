"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { AudioRangePicker } from "./AudioRangePicker";
import { btnPrimary, btnSecondary, Card, ErrorBanner, Spinner } from "./ui";

/** Step 2: the part of the song the app would use, with why. Listen, then use it, see the next best part, or pick a
 * part by hand on the waveform. ``value`` = the chosen start (null = nothing chosen yet). */
export function SongPartPicker({ projectId, file, seconds, value, onChange }: {
  projectId: string;
  file: File;
  seconds: number;
  value: number | null;
  onChange: (start: number | null) => void;
}) {
  const parts = useQuery({ queryKey: ["songParts", projectId, seconds], queryFn: () => api.songParts(projectId, seconds, 6) });
  const [i, setI] = useState(0);
  const [manual, setManual] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef(0);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Audio(url);
    el.ontimeupdate = () => {
      if (el.currentTime >= stopAt.current) {
        el.pause();
        setPlaying(false);
      }
    };
    el.onpause = () => setPlaying(false);
    audioRef.current = el;
    return () => {
      el.pause();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  function play(start: number, end: number) {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    stopAt.current = end;
    el.currentTime = start;
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  if (parts.isLoading) return <Spinner label="Finding the best part of your song…" />;
  if (parts.error) return <ErrorBanner message={errorMessage(parts.error)} onRetry={() => parts.refetch()} />;
  const list = parts.data?.parts ?? [];
  const part = list[Math.min(i, Math.max(list.length - 1, 0))];
  const chosen = value !== null && part && Math.abs(value - part.start) < 0.01;

  return (
    <div className="space-y-3">
      {parts.data?.tooShort && (
        <p className="text-sm text-warning">The song ({formatDuration(parts.data.songSeconds)}) is shorter than the Reel; the whole song is used.</p>
      )}
      {part && !manual && (
        <Card className="space-y-2">
          <p className="text-xs text-muted">
            {i === 0 ? "The part the app picks for your Reel" : `Option ${i + 1} of ${list.length}`} · {parts.data?.bpm} BPM
          </p>
          <p className="text-lg font-semibold">
            {formatDuration(part.start)} – {formatDuration(part.end)}
          </p>
          <p className="text-sm text-muted">{part.reasons.join(" · ")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => play(part.start, part.end)}>
              {playing ? "■ Stop" : "▶ Listen"}
            </button>
            <button type="button" className={btnPrimary} onClick={() => onChange(part.start)} disabled={!!chosen}>
              {chosen ? "✓ Using this part" : "Use this part"}
            </button>
            {list.length > 1 && (
              <button type="button" className={btnSecondary} onClick={() => { audioRef.current?.pause(); setI((k) => (k + 1) % list.length); }}>
                Next part ›
              </button>
            )}
            <button type="button" className="text-sm text-accent hover:underline" onClick={() => { audioRef.current?.pause(); setManual(true); }}>
              Choose it myself
            </button>
          </div>
        </Card>
      )}
      {manual && (
        <Card className="space-y-2">
          <AudioRangePicker bare source={file} duration={seconds} start={value} onChange={onChange} />
          <button type="button" className="text-sm text-accent hover:underline" onClick={() => setManual(false)}>
            ‹ Back to the suggested parts
          </button>
        </Card>
      )}
    </div>
  );
}
