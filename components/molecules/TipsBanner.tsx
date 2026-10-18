import { Icon } from "@/components/atoms/Icon";

/** "Tips for Better Reels · Simple tips to get more views" (UI/ design): the row that leads to the tips. */
export function TipsBanner({ href = "#tips-h" }: { href?: string }) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-accent/40 bg-[linear-gradient(100deg,rgba(176,92,255,.28),rgba(91,76,245,.12))] px-4 py-3 transition-colors hover:border-accent"
    >
      <Icon name="bulb" size={30} stroke={2} color="#c084fc" />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-[15px] font-extrabold">Tips for Better Reels</b>
        <span className="text-[12px] text-muted">Simple tips to get more views</span>
      </span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 transition-colors group-hover:bg-white/20">
        <Icon name="chevron" size={18} stroke={2.2} />
      </span>
    </a>
  );
}
