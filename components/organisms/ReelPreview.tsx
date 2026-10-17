"use client";

import { useRef, useState } from "react";
import { assetUrl } from "@/lib/api";
import { formatBytes, formatDuration, styleLabel } from "@/lib/format";
import { ShareReel } from "@/components/molecules/ShareReel";
import type { GenerateOptions, Rendering } from "@/types/api";
import { DurationSelector, PaceSelector, StyleSelector, type PaceId } from "@/components/organisms/StyleSelector";
import { Icon } from "@/components/atoms";

interface Props {
  rendering: Rendering;
  currentStyle: string;
  currentDuration: number;
  versionCount: number;
  /** which version this is (1 = the first) */
  versionNumber?: number;
  busy: boolean;
  onGenerate: (options: GenerateOptions) => void;
  /** Where in the song the Reel starts (seconds): shown with the no-music download, so the sound added in the app lines up. */
  songStart?: number | null;
  /** "Post it": open the publishing tools */
  onPost?: () => void;
}

const newSeed = () => Math.floor(Math.random() * 1_000_000) + 1;
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n));

/** The finished Reel (design: the project's Preview tab): the video, Download / No music / Post it, the numbers it got,
 * and quick ways to make another version. */
export function ReelPreview({ rendering, currentStyle, currentDuration, versionCount, versionNumber, busy, onGenerate, songStart, onPost }: Props) {
  const [panel, setPanel] = useState<"style" | "duration" | "pace" | null>(null);
  const [pace, setPace] = useState<PaceId>("balanced");
  const [style, setStyle] = useState(currentStyle);
  const [duration, setDuration] = useState(currentDuration);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const perf = rendering.performance;
  const engagement = perf && perf.views > 0 ? ((perf.likes + perf.comments + perf.shares + perf.saves) / perf.views) * 100 : null;
  const noMusic = assetUrl(`${rendering.downloadUrl}${rendering.downloadUrl.includes("?") ? "&" : "?"}music=false`);

  return (
    <div className="flex flex-col gap-3">
      <div className="photo p1 relative mx-auto aspect-[9/16] w-full max-w-[min(100%,calc(62svh*9/16))] md:max-w-[340px]" style={{ borderRadius: 16 }}>
        <video
          ref={video}
          key={rendering.id}
          src={assetUrl(rendering.url)}
          controls={playing}
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          className="bg-black"
          aria-label="Your Reel"
        />
        {!playing && (
          <button
            type="button"
            aria-label="Play"
            onClick={() => {
              setPlaying(true);
              void video.current?.play();
            }}
            className="absolute left-1/2 top-1/2 z-[1] grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[rgba(10,9,8,.6)] text-white"
          >
            <Icon name="play" size={22} />
          </button>
        )}
        {!playing && (
          <span className="tag">
            {formatDuration(rendering.duration)}
            {versionNumber ? ` · version ${versionNumber}` : ""}
          </span>
        )}
      </div>

      <div className="g3 mx-auto w-full md:max-w-[560px]">
        <a href={assetUrl(rendering.downloadUrl)} download className="btn sm" title={`MP4 · ${rendering.width}×${rendering.height} · ${formatBytes(rendering.size)}`}>
          <Icon name="download" size={16} />
          Download
        </a>
        <a href={noMusic} download className="btn sm" title="The same Reel with no sound: add a licensed or trending sound in Instagram or TikTok">
          No music
        </a>
        <button type="button" className="btn g sm" onClick={onPost}>
          Post it
        </button>
      </div>
      <p className="mu xs text-center">
        MP4 · <span>{`${rendering.width}×${rendering.height}`}</span> · <span>{formatBytes(rendering.size)}</span>
      </p>
      {songStart != null && (
        <p className="mu xs text-center">
          Adding a trending sound in Instagram? Download with no music and start the song at {formatDuration(songStart)}: the cuts stay on the beat.
        </p>
      )}

      {perf && (
        <div className="g3" aria-label="How it did">
          <div className="stat" style={{ gridTemplateColumns: "1fr" }}>
            <b>{compact(perf.views)}</b>
            <span className="mu xs">Views</span>
          </div>
          <div className="stat" style={{ gridTemplateColumns: "1fr" }}>
            <b>{compact(perf.likes)}</b>
            <span className="mu xs">Likes</span>
          </div>
          <div className="stat" style={{ gridTemplateColumns: "1fr" }}>
            <b>{engagement === null ? "–" : `${engagement.toFixed(1)}%`}</b>
            <span className="mu xs">Engagement</span>
          </div>
        </div>
      )}

      <div className="card" aria-label="Make another version">
        <div className="between">
          <span className="h2">Make another version</span>
          <span className="mu sm">
            {styleLabel(rendering.style)} · <span>{formatDuration(rendering.duration)}</span>
          </span>
        </div>
        <div className="chips w">
          <button type="button" disabled={busy} className="chip" title="The same settings, new choices of shots" onClick={() => onGenerate({ seed: newSeed() })}>
            Regenerate
          </button>
          <button type="button" disabled={busy} className="chip" onClick={() => onGenerate({ seed: newSeed(), label: `Version ${versionCount + 1}` })}>
            New version
          </button>
          <button type="button" disabled={busy} className={`chip ${panel === "style" ? "on" : ""}`} onClick={() => setPanel(panel === "style" ? null : "style")}>
            Style
          </button>
          <button type="button" disabled={busy} className={`chip ${panel === "duration" ? "on" : ""}`} onClick={() => setPanel(panel === "duration" ? null : "duration")}>
            Length
          </button>
          <button type="button" disabled={busy} className={`chip ${panel === "pace" ? "on" : ""}`} onClick={() => setPanel(panel === "pace" ? null : "pace")}>
            Pace
          </button>
          <ShareReel url={rendering.url} name={rendering.label || "reel"} />
        </div>
        {panel === "style" && (
          <>
            <StyleSelector value={style} onChange={setStyle} disabled={busy} />
            <button
              type="button"
              disabled={busy}
              className="btn g self-start"
              onClick={() => {
                setPanel(null);
                onGenerate({ style, seed: newSeed(), label: styleLabel(style) });
              }}
            >
              Make it {styleLabel(style)}
            </button>
          </>
        )}
        {panel === "pace" && (
          <>
            <PaceSelector value={pace} onChange={setPace} disabled={busy} />
            <button
              type="button"
              disabled={busy}
              className="btn g self-start"
              onClick={() => {
                setPanel(null);
                onGenerate({ pace, seed: newSeed(), label: `${pace} pace` });
              }}
            >
              Make it {pace}
            </button>
          </>
        )}
        {panel === "duration" && (
          <>
            <DurationSelector value={duration} onChange={setDuration} disabled={busy} />
            <button
              type="button"
              disabled={busy}
              className="btn g self-start"
              onClick={() => {
                setPanel(null);
                onGenerate({ duration, seed: newSeed(), label: `${duration}s` });
              }}
            >
              Make it {duration} seconds
            </button>
          </>
        )}
      </div>
    </div>
  );
}
