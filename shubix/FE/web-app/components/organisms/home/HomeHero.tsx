"use client";

import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { SoundBars } from "@/components/molecules/SoundBars";
import { useText } from "@/hooks/useApi";
import { heroArt, paintCss } from "@shubix/ui-web";

// the picture's colours and shapes: Shared/ui-core/src/paint.ts (the phone app draws the same)
const ground = paintCss({ angle: 135, stops: ["color-mix(in srgb, var(--surface) 92%, var(--background))", "var(--background)"], glows: heroArt.glows });
const polygon = (points: number[][]) => `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(",")})`;

/** The studio home hero: music, a vertical Reel preview, a beat waveform and a clip timeline. */
export function HomeHero({ href, reload }: { href: string; reload: boolean }) {
  const text = useText();
  return (
    <section
      aria-label="Make a Reel"
      className="home-studio-hero relative isolate -mx-4 -mt-4 overflow-hidden border-b border-border px-4 pb-6 pt-6 md:mx-0 md:mt-0 md:rounded-[28px] md:border md:px-8 md:py-8 xl:px-10 xl:py-9"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: ground }} />
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,.9fr)] md:gap-8 xl:gap-12">
        <div className="flex min-w-0 flex-col items-start gap-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/8 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-accent">
            <Icon name="music" size={14} /> {text("home.heroTag")}
          </span>
          <h1 className="m-0 max-w-[13ch] font-[family-name:var(--font-display)] text-[clamp(30px,7.5vw,48px)] font-semibold leading-[1.02] tracking-[-0.045em]">
            <span className="block text-foreground">{text("home.hero1")}</span>
            <span className="block bg-[linear-gradient(100deg,#f0d99b,#c5a45e_65%,#a98a4a)] bg-clip-text text-transparent">{text("home.hero2")}</span>
            <span className="block text-foreground/80">{text("home.hero3")}</span>
          </h1>
          <p className="m-0 max-w-[43ch] text-[13.5px] leading-relaxed text-muted md:text-[14px]">{text("home.heroText")}</p>
          <Button href={href} reload={reload} size="lg" icon="plus" iconRight="send" className="w-full max-w-[280px] md:w-auto">
            {text("home.heroButton")}
          </Button>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-[11px] font-semibold text-muted">
            <span className="inline-flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-accent" />{text("home.step1")}</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-accent/70" />{text("home.step2")}</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-accent/45" />{text("home.step3")}</span>
          </div>
        </div>

        <div aria-hidden className="relative mx-auto grid w-full max-w-[420px] grid-cols-[minmax(96px,.72fr)_minmax(0,1.28fr)] items-center gap-3 rounded-[24px] border border-white/10 bg-black/20 p-3 shadow-[0_24px_65px_-40px_rgba(0,0,0,.9)] backdrop-blur-sm md:gap-4 md:p-4">
          <div className="relative aspect-[9/16] overflow-hidden rounded-[18px] border border-white/15 shadow-[0_16px_34px_-16px_rgba(0,0,0,.8)]" style={{ background: paintCss(heroArt.sky) }}>
            <span className="absolute left-[18%] top-[18%] size-[46%] rounded-full blur-[1px]" style={{ background: heroArt.sun }} />
            {heroArt.hills.map((hill) => <span key={hill.height} className="absolute inset-x-0 bottom-0" style={{ height: `${hill.height}%`, background: paintCss(hill.paint), clipPath: polygon(hill.points) }} />)}
            <span className="absolute left-2.5 top-2.5 rounded-full border border-white/25 bg-black/25 px-2 py-1 text-[10px] font-bold tracking-[.12em] text-white/90 backdrop-blur">{text("home.mockPreview")}</span>
            <span className="absolute inset-0 grid place-items-center"><i className="grid size-9 place-items-center rounded-full border border-white/55 bg-black/25 text-white shadow-lg backdrop-blur"><Icon name="play" size={16} /></i></span>
            <span className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-[.1em] text-white/80"><Icon name="sparkle" size={11} /> {text("home.mockMove")}</span>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[.045] p-3 md:p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2"><i className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><Icon name="music" size={15} /></i><span className="truncate text-[10px] font-bold uppercase tracking-[.12em] text-white/75">{text("home.mockSound")}</span></span>
                <span className="shrink-0 font-mono text-[10px] text-white/45">00:24</span>
              </div>
              <SoundBars bars={heroArt.bars} className="h-10 gap-[2px]" />
              <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-white/40"><span>0:00</span><span className="text-accent/85">{text("home.mockBeat")}</span><span>0:24</span></div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[.045] p-3 md:p-3.5">
              <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.13em] text-white/50">{text("home.mockClips")}</span><span className="text-[10px] text-white/40">{text("home.mockMoments")}</span></div>
              <div className="flex h-9 gap-1 overflow-hidden rounded-lg">
                {heroArt.clips.map((clip, i) => <i key={i} className="flex-1 rounded-md" style={{ background: paintCss(clip) }} />)}
              </div>
              <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-white/10"><i className="absolute inset-y-0 left-0 w-[62%] rounded-full [background:var(--gold-gradient)]" /><i className="absolute -top-1 left-[62%] h-3 w-px bg-white/90" /></div>
            </div>
            <span className="flex items-center gap-2 pl-1 text-[10px] font-semibold uppercase tracking-[.13em] text-white/45"><i className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" /> {text("home.mockSync")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
