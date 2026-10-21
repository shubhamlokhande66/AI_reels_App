import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import { cn } from "@/lib/cn";
import { TONE_BG, TONE_GLOW, type Tone } from "@/lib/ui";

/** One way to start a Reel (UI/ design: Create Options): its tone's gradient, a white icon, a title, a line, and the
 * arrow chip. `reload`: a full page load (Fast Studio). */
export function CreateCard({ href, icon, title, text, tone, reload = false }: { href: string; icon: string; title: string; text: string; tone: Tone; reload?: boolean }) {
  const Tag = reload ? "a" : Link;
  return (
    <Tag
      href={href}
      className={cn(
        "group relative flex min-h-[108px] flex-col justify-between gap-3 overflow-hidden rounded-2xl border border-white/10 p-3.5 text-white transition-transform duration-200 hover:-translate-y-0.5 md:min-h-[128px] md:p-4",
        TONE_BG[tone],
        TONE_GLOW[tone],
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/15 blur-2xl" />
      <span className="flex items-start justify-between gap-2">
        <Icon name={icon} size={30} stroke={2} />
        <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-black/20 transition-colors group-hover:bg-black/35">
          <Icon name="send" size={15} stroke={2.4} />
        </span>
      </span>
      <span className="flex flex-col">
        {/* 7 in a row on a computer (lg): a touch smaller, so every title stays on one line */}
        <b className="text-[14.5px] font-extrabold leading-tight md:text-base lg:text-[15px]">{title}</b>
        <span className="text-[11.5px] leading-snug text-white/80 md:text-[12.5px] lg:text-xs">{text}</span>
      </span>
    </Tag>
  );
}
