import { cn } from "@/lib/cn";
import { TONE_BG, type Tone } from "@/lib/ui";
import { Icon } from "./Icon";

/** An icon on its tone's gradient square (a Music Reel's note, a Talking Reel's mic). */
export function IconTile({ icon, tone = "brand", size = 42, className }: { icon: string; tone?: Tone; size?: number; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl text-white", TONE_BG[tone], className)} style={{ width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.5)} stroke={2} />
    </span>
  );
}
