"use client";

import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { SoundBars } from "@/components/molecules/SoundBars";
import { useT } from "@/hooks/useApi";

const WAVE = [8, 14, 22, 11, 28, 17, 34, 12, 23, 38, 18, 29, 13, 35, 20, 10, 31, 16, 39, 24, 12, 30, 19, 36, 14, 25, 9, 33, 18, 28, 12, 38, 20, 30, 14, 24];

/** The studio home hero: music, a vertical Reel preview, a beat waveform and a clip timeline. */
export function HomeHero({ href, reload }: { href: string; reload: boolean }) {
  const t = useT();
  return (
    <section
      aria-label="Make a Reel"
      className="home-studio-hero relative isolate -mx-4 -mt-4 overflow-hidden border-b border-border px-4 pb-6 pt-6 md:mx-0 md:mt-0 md:rounded-[28px] md:border md:px-8 md:py-8 xl:px-10 xl:py-9"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_100%_at_82%_18%,rgba(216,189,123,.2),transparent_58%),radial-gradient(48%_80%_at_8%_100%,rgba(216,189,123,.07),transparent_70%),linear-gradient(135deg,color-mix(in_srgb,var(--surface)_92%,var(--background)),var(--background))]" />
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,.9fr)] md:gap-8 xl:gap-12">
        <div className="flex min-w-0 flex-col items-start gap-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/8 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-accent">
            <Icon name="music" size={14} /> Beat-synced reel studio
          </span>
          <h1 className="m-0 max-w-[13ch] font-[family-name:var(--font-display)] text-[clamp(30px,7.5vw,48px)] font-semibold leading-[1.02] tracking-[-0.045em]">
            <span className="block text-foreground">{t("home.hero1")}</span>
            <span className="block bg-[linear-gradient(100deg,#f0d99b,#c5a45e_65%,#a98a4a)] bg-clip-text text-transparent">{t("home.hero2")}</span>
            <span className="block text-foreground/80">{t("home.hero3")}</span>
          </h1>
          <p className="m-0 max-w-[43ch] text-[13.5px] leading-relaxed text-muted md:text-[14px]">{t("home.heroText")}</p>
          <Button href={href} reload={reload} size="lg" icon="plus" iconRight="send" className="w-full max-w-[280px] md:w-auto">
            {t("home.heroButton")}
          </Button>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-[11px] font-semibold text-muted">
            <span className="inline-flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-accent" />Pick a sound</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-accent/70" />Cut to the beat</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-accent/45" />Export your Reel</span>
          </div>
        </div>

        <div aria-hidden className="relative mx-auto grid w-full max-w-[420px] grid-cols-[minmax(96px,.72fr)_minmax(0,1.28fr)] items-center gap-3 rounded-[24px] border border-white/10 bg-black/20 p-3 shadow-[0_24px_65px_-40px_rgba(0,0,0,.9)] backdrop-blur-sm md:gap-4 md:p-4">
          <div className="relative aspect-[9/16] overflow-hidden rounded-[18px] border border-white/15 bg-[linear-gradient(180deg,#c6a766_0%,#76613b_38%,#3b3427_58%,#171714_100%)] shadow-[0_16px_34px_-16px_rgba(0,0,0,.8)]">
            <span className="absolute left-[18%] top-[18%] size-[46%] rounded-full bg-[#f2d99a]/80 blur-[1px]" />
            <span className="absolute inset-x-0 bottom-0 h-[58%] bg-[linear-gradient(160deg,transparent_10%,rgba(23,22,18,.72)_10.5%,#171714_72%)] [clip-path:polygon(0_48%,32%_0,55%_42%,73%_18%,100%_52%,100%_100%,0_100%)]" />
            <span className="absolute inset-x-0 bottom-0 h-[36%] bg-[linear-gradient(165deg,transparent_5%,#29271f_5.5%,#111110_90%)] [clip-path:polygon(0_40%,24%_4%,49%_45%,72%_0,100%_28%,100%_100%,0_100%)]" />
            <span className="absolute left-2.5 top-2.5 rounded-full border border-white/25 bg-black/25 px-2 py-1 text-[8px] font-bold tracking-[.12em] text-white/90 backdrop-blur">9:16 PREVIEW</span>
            <span className="absolute inset-0 grid place-items-center"><i className="grid size-9 place-items-center rounded-full border border-white/55 bg-black/25 text-white shadow-lg backdrop-blur"><Icon name="play" size={16} /></i></span>
            <span className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center gap-1.5 text-[8px] font-semibold tracking-[.1em] text-white/80"><Icon name="sparkle" size={11} /> MADE TO MOVE</span>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[.045] p-3 md:p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2"><i className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><Icon name="music" size={15} /></i><span className="truncate text-[10px] font-bold uppercase tracking-[.12em] text-white/75">Soundtrack</span></span>
                <span className="shrink-0 font-mono text-[9px] text-white/45">00:24</span>
              </div>
              <SoundBars bars={WAVE} className="h-10 gap-[2px]" />
              <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-white/40"><span>0:00</span><span className="text-accent/85">BEAT MATCH</span><span>0:24</span></div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[.045] p-3 md:p-3.5">
              <div className="mb-2 flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-[.13em] text-white/50">Your clips</span><span className="text-[9px] text-white/40">3 moments</span></div>
              <div className="flex h-9 gap-1 overflow-hidden rounded-lg">
                <i className="flex-1 rounded-md bg-[linear-gradient(145deg,#b9a06d,#555044_55%,#26251f)]" />
                <i className="flex-1 rounded-md bg-[linear-gradient(145deg,#9c8970,#484138_55%,#23221e)]" />
                <i className="flex-1 rounded-md bg-[linear-gradient(145deg,#bea77e,#66573f_55%,#28251f)]" />
                <i className="flex-1 rounded-md bg-[linear-gradient(145deg,#776e58,#3e3a30_55%,#1f1e1a)]" />
              </div>
              <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-white/10"><i className="absolute inset-y-0 left-0 w-[62%] rounded-full [background:var(--gold-gradient)]" /><i className="absolute -top-1 left-[62%] h-3 w-px bg-white/90" /></div>
            </div>
            <span className="flex items-center gap-2 pl-1 text-[9px] font-semibold uppercase tracking-[.13em] text-white/45"><i className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" /> Clips, music, perfectly in sync</span>
          </div>
        </div>
      </div>
    </section>
  );
}
