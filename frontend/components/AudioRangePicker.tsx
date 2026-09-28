"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { btnSecondary } from "./ui";

const BINS = 600;
const LOAD_TIMEOUT_MS = 8000; // how long to wait for the song to become playable before saying so
const SCRUB_MS = 90; // while dragging, re-position the sound at most this often

/** Peaks (0..1) of a decoded song, and its length. Runs in the browser; nothing is uploaded for this. */
async function decodePeaks(data: ArrayBuffer): Promise<{ peaks: number[]; length: number }> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("This browser cannot read audio here.");
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(data);
    const ch = buf.getChannelData(0);
    const per = Math.max(Math.floor(ch.length / BINS), 1);
    const peaks: number[] = [];
    for (let b = 0; b < BINS; b++) {
      let sum = 0;
      const from = b * per;
      const to = Math.min(from + per, ch.length);
      for (let i = from; i < to; i += 8) sum += ch[i] * ch[i];
      peaks.push(Math.sqrt(sum / Math.max((to - from) / 8, 1)));
    }
    const max = Math.max(...peaks, 1e-6);
    return { peaks: peaks.map((p) => p / max), length: buf.duration };
  } finally {
    void ctx.close();
  }
}

export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

export const fmt = (s: number) => formatDuration(s);

interface Props {
  /** Draw without its own box, to sit inside another card (a divider is drawn above it instead). */
  bare?: boolean;
  /** The song: a File the user just chose, or a URL of one already uploaded. */
  source: File | string;
  /** Length of the Reel in seconds: the size of the window. */
  duration: number;
  /** Chosen start in seconds, or null = the app chooses the best part. */
  start: number | null;
  onChange: (start: number | null) => void;
}

/** Choose which part of the song the Reel uses. Shows the whole song, and a window as long as the Reel. */
export function AudioRangePicker(props: Props) {
  // keyed by the source so a different song starts fresh (no state juggling in effects)
  const id = typeof props.source === "string" ? props.source : `${props.source.name}:${props.source.size}:${props.source.lastModified}`;
  return <Picker key={id} {...props} />;
}

function Picker({ source, duration, start, onChange, bare = false }: Props) {
  const [song, setSong] = useState<{ peaks: number[]; length: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const untilRef = useRef<number>(Number.POSITIVE_INFINITY); // where the current preview should stop
  const pendingFrom = useRef(0); // where it should be playing from (the latest request wins while the file is still loading)
  const waiting = useRef(false);
  const wantPlay = useRef(false); // a play was requested and has not started yet
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(false);
  const lastSeek = useRef(0);
  const playedFrom = useRef<number | null>(null);
  const chosen = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const urlRef = useRef<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  // The playback link is made when the user presses play and released when the picker goes away. (Making it during render
  // and revoking it in an effect cleanup broke playback: React's development double-mount revoked it before it was ever used.)
  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (loadTimer.current) clearTimeout(loadTimer.current);
      if (urlRef.current && typeof source !== "string") URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [source],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = typeof source === "string" ? await (await fetch(source)).arrayBuffer() : await source.arrayBuffer();
        const r = await decodePeaks(data);
        if (!cancelled) setSong(r);
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message : "The song could not be read for the preview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const length = song?.length ?? null;
  const fits = length === null || duration < length - 0.05;
  const latest = length === null ? 0 : Math.max(length - duration, 0);
  const shown = start === null ? null : length === null ? start : Math.min(Math.max(start, 0), latest);
  const pct = (t: number) => (length ? `${(t / length) * 100}%` : "0%");

  function stop() {
    wantPlay.current = false;
    if (loadTimer.current) clearTimeout(loadTimer.current);
    setLoading(false);
    audioRef.current?.pause();
    setPlaying(false);
    setPlayhead(null);
  }

  function ensureAudio(): HTMLAudioElement {
    if (audioRef.current) return audioRef.current;
    urlRef.current = typeof source === "string" ? source : URL.createObjectURL(source);
    const a = new Audio(urlRef.current);
    a.ontimeupdate = () => {
      setPlayhead(a.currentTime);
      if (a.currentTime >= untilRef.current - 0.05) stop();
    };
    a.onended = () => {
      setPlaying(false);
      setPlayhead(null);
    };
    a.onerror = () => {
      setPlaying(false);
      setPlayError("This browser could not play the song here.");
    };
    audioRef.current = a;
    return a;
  }

  /**
   * Play from `from` until `until`. If it is already playing it just jumps there: no stop-and-resume, so moving the
   * window while listening keeps the music going from the new spot.
   */
  function playFrom(from: number, until: number) {
    setPlayError(null);
    const a = ensureAudio();
    untilRef.current = until;
    pendingFrom.current = from;
    playedFrom.current = from;
    wantPlay.current = true;
    const go = () => {
      if (!wantPlay.current) return; // gave up waiting (or stopped) in the meantime
      wantPlay.current = false;
      if (loadTimer.current) clearTimeout(loadTimer.current);
      setLoading(false);
      a.currentTime = pendingFrom.current;
      if (!a.paused) {
        setPlaying(true);
        return;
      }
      Promise.resolve(a.play()).then(() => setPlaying(true)).catch((e: unknown) => {
        setPlaying(false);
        setPlayError(e instanceof Error && e.name === "NotAllowedError" ? "The browser blocked playback. Press play again." : "The song could not be played.");
      });
    };
    if (a.readyState >= 1) go();
    else {
      // Seeking before the file's length is known is ignored by browsers, so wait for it (one listener; the newest request wins).
      // Say so while waiting, and say when it is taking too long, instead of a button that seems to do nothing.
      setLoading(true);
      if (loadTimer.current) clearTimeout(loadTimer.current);
      loadTimer.current = setTimeout(() => {
        wantPlay.current = false;
        setLoading(false);
        setPlayError("The song is taking too long to load in this browser tab. Press play to try again.");
      }, LOAD_TIMEOUT_MS);
      if (!waiting.current) {
        waiting.current = true;
        a.addEventListener("loadedmetadata", () => {
          waiting.current = false;
          go();
        }, { once: true });
        a.load();
      }
    }
  }

  /** The play button. With "let the app choose" there is no part yet, so it plays the song from the start. */
  function play() {
    playFrom(shown ?? 0, shown === null ? Number.POSITIVE_INFINITY : shown + duration);
  }

  /** The user moved the window: update it and start playing from there straight away (no press of play needed). */
  function choose(t: number, force: boolean) {
    const v = Math.round(Math.min(Math.max(t, 0), length === null ? Math.max(t, 0) : latest) * 10) / 10;
    chosen.current = v;
    onChange(v);
    const now = performance.now();
    if (!force && now - lastSeek.current < SCRUB_MS) return; // while dragging, follow the pointer without a seek on every pixel
    lastSeek.current = now;
    playFrom(v, v + duration);
  }

  /** The drag/slider ended: make sure the sound is exactly where the window ended up. */
  function settle() {
    const c = chosen.current;
    if (c !== null && c !== playedFrom.current) playFrom(c, c + duration);
  }

  function fromPointer(clientX: number, force: boolean) {
    const r = box.current?.getBoundingClientRect();
    if (!r || !length || !r.width) return;
    choose(((clientX - r.left) / r.width) * length - duration / 2, force); // the window is centred on the pointer
  }

  function loudest() {
    if (!song) return;
    const w = Math.max(Math.round((duration / song.length) * song.peaks.length), 1);
    let sum = song.peaks.slice(0, w).reduce((a, b) => a + b, 0);
    let best = sum;
    let at = 0;
    for (let i = w; i < song.peaks.length; i++) {
      sum += song.peaks[i] - song.peaks[i - w];
      if (sum > best) {
        best = sum;
        at = i - w + 1;
      }
    }
    choose((at / song.peaks.length) * song.length, true);
  }

  const path = song ? "M0,30 " + song.peaks.map((p, i) => `L${i},${30 - p * 28}`).join(" ") + ` L${song.peaks.length},30 ` + song.peaks.map((p, i) => `L${song.peaks.length - 1 - i},${30 + song.peaks[song.peaks.length - 1 - i] * 28}`).join(" ") + " Z" : "";

  return (
    <div
      className={bare ? "space-y-3 border-t border-border pt-4" : "space-y-3 rounded-xl border border-border bg-surface p-4"}
      aria-label="Part of the song"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Which part of the song?</h3>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={start === null}
            onChange={(e) => {
              if (e.target.checked) stop(); // handing the choice back to the app ends the preview
              onChange(e.target.checked ? null : 0);
            }}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Let the app choose the best part
        </label>
      </div>

      {failed && <p className="text-xs text-muted">Preview not available ({failed}). You can still type where to start.</p>}
      {length !== null && !fits && (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          The song is {fmt(length)} long, not longer than the {fmt(duration)} Reel, so all of it is used and the Reel is shortened to fit.
        </p>
      )}

      {song && (
        <div
          ref={box}
          role="presentation"
          className={`relative h-16 select-none overflow-hidden rounded-lg bg-surface-2 ${start === null || !fits ? "opacity-60" : "cursor-pointer"}`}
          onPointerDown={(e) => {
            if (!fits) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            fromPointer(e.clientX, true);
          }}
          onPointerMove={(e) => e.buttons === 1 && fits && fromPointer(e.clientX, false)}
          onPointerUp={settle}
        >
          <svg viewBox={`0 0 ${song.peaks.length} 60`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            <path d={path} className="fill-muted/60" />
          </svg>
          {playing && playhead !== null && (
            <div data-testid="playhead" className="absolute inset-y-0 z-10 w-0.5 bg-white" style={{ left: pct(playhead) }} />
          )}
          {shown !== null && fits && (
            <div
              data-testid="range-window"
              className="absolute inset-y-0 rounded border-2 border-accent bg-accent/25"
              style={{ left: pct(shown), width: `${Math.min((duration / (length ?? 1)) * 100, 100)}%` }}
            />
          )}
        </div>
      )}

      {fits && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="text-xs text-muted">
            Start · {shown === null ? "automatic" : fmt(shown)}
            <input
              type="range"
              aria-label="Start of the part of the song"
              min={0}
              max={length === null ? 600 : Math.max(latest, 0.1)}
              step={0.1}
              disabled={start === null || length === null}
              value={shown ?? 0}
              onChange={(e) => choose(Number(e.target.value), false)}
              onPointerUp={settle}
              onKeyUp={settle}
              className="mt-1 w-full accent-[var(--accent)]"
            />
          </label>
          <label className="text-xs text-muted">
            Type a start (m:ss)
            <input
              aria-label="Start time"
              inputMode="text"
              placeholder="1:30"
              disabled={start === null}
              value={text ?? (shown === null ? "" : fmt(shown))}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                const v = text === null ? null : parseTime(text);
                if (v !== null) choose(v, true);
                setText(null);
              }}
              className="mt-1 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
            />
          </label>
        </div>
      )}

      {playError && <p role="alert" className="text-xs text-danger">{playError}</p>}
      {loading && <p role="status" className="text-xs text-muted">Loading the song… it starts as soon as it is ready.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} onClick={playing || loading ? stop : play}>
          {playing ? "■ Stop" : loading ? "Loading…" : shown === null || !fits ? "▶ Play the song" : "▶ Play this part"}
        </button>
        <button type="button" className={btnSecondary} disabled={!song || !fits} onClick={loudest}>
          Pick the loudest part
        </button>
        <span className="text-xs text-muted" aria-live="polite">
          {length === null
            ? "Reading the song…"
            : start === null || !fits
              ? `Song ${fmt(length)}. ${fits ? "The app will pick the most energetic part." : ""}`
              : `Using ${fmt(shown ?? 0)} – ${fmt((shown ?? 0) + duration)} of a ${fmt(length)} song`}
        </span>
      </div>
    </div>
  );
}
