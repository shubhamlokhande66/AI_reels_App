import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/ui";
import { toneBackground } from "@shubix/ui-web";
import { Icon } from "./Icon";

/** An icon on its tone's gradient square (a Music Reel's note, a Talking Reel's mic). */
export function IconTile({ icon, tone = "brand", size = 42, className }: { icon: string; tone?: Tone; size?: number; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl text-white", className)} style={{ width: size, height: size, background: toneBackground(tone) }}>
      <Icon name={icon} size={Math.round(size * 0.5)} stroke={2} />
    </span>
  );
}
