"use client";

import { useState } from "react";
import { assetUrl } from "@/lib/api";
import { formatBytes, formatDuration, styleLabel } from "@/lib/format";
import { ShareReel } from "./ShareReel";
import type { GenerateOptions, Rendering } from "@/types/api";
import { DurationSelector, PaceSelector, StyleSelector, type PaceId } from "./StyleSelector";
import { btnPrimary, btnSecondary } from "./ui";

interface Props {
  rendering: Rendering;
  currentStyle: string;
  currentDuration: number;
  versionCount: number;
  busy: boolean;
  onGenerate: (options: GenerateOptions) => void;
  /** Where in the song the Reel starts (seconds): shown with the no-music download, so the sound added in the app lines up. */
  songStart?: number | null;
}

const newSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

export function ReelPreview({ rendering, currentStyle, currentDuration, versionCount, busy, onGenerate, songStart }: Props) {
  const [panel, setPanel] = useState<"style" | "duration" | "pace" | null>(null);
  const [pace, setPace] = useState<PaceId>("balanced");
  const [style, setStyle] = useState(currentStyle);
  const [duration, setDuration] = useState(currentDuration);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      <div className="mx-auto w-full max-w-[min(340px,calc(62svh*9/16))] lg:max-w-[340px]">
        <video
          key={rendering.id}
          src={assetUrl(rendering.url)}
          controls
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full rounded-2xl border border-border bg-black"
          aria-label="Generated Reel"
        />
      </div>

      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Duration", formatDuration(rendering.duration)],
            ["Resolution", `${rendering.width}×${rendering.height}`],
            ["File size", formatBytes(rendering.size)],
            ["Style", styleLabel(rendering.style)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-surface p-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        {songStart != null && (
          <p className="text-xs text-muted">
            Posting with a licensed or trending sound? Use <span className="text-foreground">Download without music</span>, then in
            Instagram or TikTok add your song and start it at <span className="text-foreground">{formatDuration(songStart)}</span>: the
            cuts stay on the beat.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <a href={assetUrl(rendering.downloadUrl)} download className={`${btnPrimary} col-span-2`}>
            Download MP4
          </a>
          <a
            href={assetUrl(`${rendering.downloadUrl}${rendering.downloadUrl.includes("?") ? "&" : "?"}music=false`)}
            download
            className={`${btnSecondary} col-span-2`}
            title="The same Reel with no sound: add a licensed or trending sound in Instagram / TikTok (no muted posts)"
          >
            Download without music
          </a>
          <ShareReel url={rendering.url} name={rendering.label || "reel"} />
          <button type="button" disabled={busy} className={btnSecondary} onClick={() => onGenerate({ seed: newSeed() })}>
            Regenerate
          </button>
          <button type="button" disabled={busy} className={btnSecondary} onClick={() => setPanel(panel === "style" ? null : "style")}>
            Change style
          </button>
          <button type="button" disabled={busy} className={btnSecondary} onClick={() => setPanel(panel === "duration" ? null : "duration")}>
            Change duration
          </button>
          <button type="button" disabled={busy} className={btnSecondary} onClick={() => setPanel(panel === "pace" ? null : "pace")}>
            Change pace
          </button>
          <button
            type="button"
            disabled={busy}
            className={btnSecondary}
            onClick={() => onGenerate({ seed: newSeed(), label: `Version ${versionCount + 1}` })}
          >
            Create another version
          </button>
        </div>

        {panel === "style" && (
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <StyleSelector value={style} onChange={setStyle} disabled={busy} />
            <button
              type="button"
              disabled={busy}
              className={btnPrimary}
              onClick={() => {
                setPanel(null);
                onGenerate({ style, seed: newSeed(), label: styleLabel(style) });
              }}
            >
              Re-render in {styleLabel(style)}
            </button>
          </div>
        )}
        {panel === "pace" && (
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <PaceSelector value={pace} onChange={setPace} disabled={busy} />
            <div>
              <button
                type="button"
                disabled={busy}
                className={btnPrimary}
                onClick={() => {
                  setPanel(null);
                  onGenerate({ pace, seed: newSeed(), label: `${pace} pace` });
                }}
              >
                Re-render with {pace} pace
              </button>
            </div>
          </div>
        )}
        {panel === "duration" && (
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <DurationSelector value={duration} onChange={setDuration} disabled={busy} />
            <div>
              <button
                type="button"
                disabled={busy}
                className={btnPrimary}
                onClick={() => {
                  setPanel(null);
                  onGenerate({ duration, seed: newSeed(), label: `${duration}s` });
                }}
              >
                Re-render at {duration}s
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
