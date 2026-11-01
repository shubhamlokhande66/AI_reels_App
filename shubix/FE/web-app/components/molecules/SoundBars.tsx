import { cn } from "@/lib/cn";

/** Gold sound bars bouncing to a beat, one after another (Home's mixboard, the sign-in page). `bars`: each bar's height
 * (`unit` px or %); `step`: the delay between neighbours, in seconds (negative: already moving when the page opens). */
export function SoundBars({ bars, unit = "px", step = 0.09, speed = "animate-[wave_1.25s_ease-in-out_infinite_alternate]", className, barClassName }: { bars: number[]; unit?: "px" | "%"; step?: number; speed?: string; className?: string; barClassName?: string }) {
  return (
    <div aria-hidden className={cn("flex items-center justify-between overflow-hidden", className)}>
      {bars.map((h, i) => <i key={i} style={{ height: h + unit, animationDelay: (i % 9) * step + "s" }}
        className={cn("block min-w-0.5 max-w-1 flex-[1_1_2px] origin-center rounded-full bg-[linear-gradient(180deg,#f0d99b,#a98a4a)] motion-reduce:animate-none", speed, barClassName)} />)}
    </div>
  );
}
