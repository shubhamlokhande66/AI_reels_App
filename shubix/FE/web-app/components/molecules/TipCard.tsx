import { Icon } from "@/components/atoms/Icon";

/** A short tip (UI/ design: Tips for Better Reels): a coloured icon, the number and the tip, one line of why.
 * Two a row on a phone (type that reads), four from a tablet up. */
export function TipCard({ n, icon, color, title, text }: { n: number; icon: string; color: string; title: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border bg-surface p-3 sm:gap-2 sm:p-3.5">
      <Icon name={icon} size={26} stroke={2} color={color} />
      <b className="text-[13px] font-extrabold leading-snug sm:text-[14px]">
        {n}. {title}
      </b>
      <span className="text-[12px] leading-snug text-muted">{text}</span>
    </div>
  );
}
