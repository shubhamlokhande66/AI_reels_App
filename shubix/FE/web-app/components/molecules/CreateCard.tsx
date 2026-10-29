import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import { LockBadge } from "@/components/molecules/LockBadge";
import { cn } from "@/lib/cn";
import { TONE_GLOW, type Tone } from "@/lib/ui";
import { toneBackground } from "@shubix/ui-web";

/** One way to start a Reel (UI/ design: Create Options): its tone's gradient, a white icon, a title, a line, and the
 * arrow chip. `reload`: a full page load (Fast Studio). `lock`: its tag on a lower plan ("Upgrade", with a crown), and a
 * tap opens the plans. */
export function CreateCard({ href, icon, title, text, tone, reload = false, lock = "" }: { href: string; icon: string; title: string; text: string; tone: Tone; reload?: boolean; lock?: string }) {
  const Tag = reload && !lock ? "a" : Link;
  const music = href === "/create/music";
  return (
    <Tag
      href={lock ? "/pricing?need=" + encodeURIComponent(href) : href}
      aria-label={lock ? `${title}: in a paid plan` : undefined}
      className={cn(
        "group relative flex min-h-[108px] flex-col justify-between gap-3 overflow-hidden rounded-2xl border border-white/10 p-3.5 text-white transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 md:min-h-[128px] md:p-4",
        music && "col-span-2 min-h-[118px] border-white/30 shadow-[0_18px_38px_-24px_rgba(180,145,75,.75)] sm:col-span-1",
        TONE_GLOW[tone],
      )}
      style={{ background: toneBackground(tone) }}
    >
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/15 blur-2xl" />
      <span className="flex items-start justify-between gap-2">
        <span className={cn(music && "grid h-9 w-9 place-items-center rounded-xl bg-white/15 shadow-[0_0_0_1px_rgba(255,255,255,.16)_inset]")}><Icon name={icon} size={music ? 21 : 30} stroke={2} /></span>
        {lock ? (
          <LockBadge card />
        ) : (
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-black/20 transition-colors group-hover:bg-black/35">
            <Icon name="send" size={15} stroke={2.4} />
          </span>
        )}
      </span>
      <span className="flex flex-col">
        {/* 7 in a row on a computer (lg): a touch smaller, so every title stays on one line */}
        <b className="text-[14.5px] font-extrabold leading-tight md:text-base lg:text-[15px]">{title}</b>
        <span className="text-[11.5px] leading-snug text-white/80 md:text-[12.5px] lg:text-xs">{text}</span>
      </span>
    </Tag>
  );
}
