"use client";

import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { useT } from "@/hooks/useApi";

/** Home's hero (UI/ design): "Your moments. Your story. Your Reel.", the line under it, the Create Reel button, and
 * on the right three Reels fanned out with "Create · Edit · Share". `reload`: Create opens Fast Studio (a full load). */
export function HomeHero({ href, reload }: { href: string; reload: boolean }) {
  const t = useT();
  return (
    <section
      aria-label="Make a Reel"
      className="relative -mx-4 -mt-4 overflow-hidden px-4 pb-6 pt-6 md:mx-0 md:mt-0 md:rounded-3xl md:border md:border-border md:px-10 md:py-12"
    >
      {/* the glow behind */}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_80%_at_85%_20%,rgba(224,64,251,.45),transparent_60%),radial-gradient(60%_70%_at_100%_90%,rgba(109,93,252,.35),transparent_60%),linear-gradient(180deg,rgba(176,92,255,.10),transparent)]" />
      <div aria-hidden className="absolute right-[8%] top-[12%] h-3 w-3 rounded-full bg-[#ffb36b] opacity-70 blur-[2px]" />
      <div aria-hidden className="absolute right-[30%] top-[6%] h-2 w-2 rounded-full bg-[#ff7ae0] opacity-80 blur-[1px]" />

      <div className="relative grid items-center gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="flex max-w-xl flex-col gap-4">
          <h1 className="m-0 font-[family-name:var(--font-display)] text-[clamp(30px,7.5vw,46px)] font-semibold leading-[1.05] tracking-[-0.025em]">
            <span className="block text-foreground">{t("home.hero1")}</span>
            <span className="block bg-[linear-gradient(90deg,#c084fc,#a855f7)] bg-clip-text text-transparent">{t("home.hero2")}</span>
            <span className="block bg-[linear-gradient(90deg,#ff4fd8,#e040fb)] bg-clip-text text-transparent">{t("home.hero3")}</span>
          </h1>
          <p className="m-0 max-w-[30ch] text-[14.5px] leading-relaxed text-foreground/85 md:max-w-md md:text-base">
            {t("home.heroText")}
          </p>
          <Button href={href} reload={reload} size="lg" icon="plus" iconRight="send" className="w-full max-w-sm md:w-fit md:min-w-[280px]">
            {t("home.heroButton")}
          </Button>
        </div>

        {/* three Reels fanned out (computers and tablets; on a phone the glow carries the hero) */}
        <div aria-hidden className="relative hidden h-[300px] md:block">
          {[
            { r: "-rotate-12", x: "left-[6%]", bg: "bg-[linear-gradient(160deg,#3b8bff,#1d3a8a)]", icon: "mic" },
            { r: "rotate-0", x: "left-[30%] z-10 -top-3", bg: "bg-[linear-gradient(160deg,#ff3fd0,#6d28d9)]", icon: "music" },
            { r: "rotate-12", x: "left-[54%]", bg: "bg-[linear-gradient(160deg,#ff9a3d,#ff4f6d)]", icon: "image" },
          ].map((c) => (
            <div key={c.icon} className={`absolute top-4 h-[250px] w-[140px] rounded-[22px] border border-white/20 p-2 shadow-[0_24px_50px_-20px_rgba(0,0,0,.7)] ${c.r} ${c.x} ${c.bg}`}>
              <div className="flex h-full flex-col justify-between rounded-[16px] bg-black/15 p-3 text-white">
                <Icon name={c.icon} size={26} stroke={2} />
                <span className="grid h-10 w-10 place-items-center self-center rounded-full border-2 border-white/80 bg-black/30">
                  <Icon name="play" size={16} />
                </span>
                <span className="h-1.5 w-2/3 rounded-full bg-white/50" />
              </div>
            </div>
          ))}
          <span className="absolute bottom-0 right-2 rotate-[-8deg] text-right font-[family-name:var(--font-display)] text-[26px] font-bold italic leading-[1.05] text-white/90">
            Create
            <br />
            Edit <span className="text-[#ff7ae0]">♥</span>
            <br />
            Share
          </span>
        </div>
      </div>
    </section>
  );
}
