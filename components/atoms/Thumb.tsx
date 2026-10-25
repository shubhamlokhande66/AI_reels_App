import { assetUrl } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Photo } from "./Photo";

// warm placeholder pictures (a soft light over a dark gradient) for a thumbnail that is not there yet
const PLACEHOLDERS = [
  "radial-gradient(circle at 50% 38%, rgba(255,206,140,.75) 0, rgba(255,170,90,.25) 22%, transparent 42%), linear-gradient(180deg, #5e3b1f, #1b120b)",
  "radial-gradient(circle at 60% 30%, rgba(255,240,200,.7) 0, transparent 30%), linear-gradient(180deg, #2f6f9a 0, #1b4d6b 55%, #c9a46a 56%, #8a6a3f)",
  "radial-gradient(circle at 50% 60%, rgba(255,170,90,.8) 0, transparent 38%), linear-gradient(180deg, #f0a35a, #7a3b2a 60%, #2a1810)",
  "radial-gradient(circle at 45% 55%, rgba(240,200,140,.8) 0, rgba(200,120,60,.4) 25%, transparent 45%), linear-gradient(180deg, #3a2414, #120b07)",
  "radial-gradient(circle at 50% 35%, rgba(250,210,180,.6) 0, transparent 28%), linear-gradient(180deg, #7a1f24, #3a0f12)",
  "radial-gradient(circle at 70% 25%, rgba(255,220,150,.6) 0, transparent 20%), linear-gradient(180deg, #1d2440, #0c0f1c)",
  "radial-gradient(circle at 50% 40%, rgba(255,235,210,.55) 0, transparent 30%), linear-gradient(180deg, #b9a48a, #6e5a44)",
];
/** the same placeholder for the same id */
export function placeholderFor(id: string | undefined | null): string {
  let h = 0;
  for (const c of id ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PLACEHOLDERS[h % PLACEHOLDERS.length];
}

/** A project's or clip's picture, else its warm placeholder (the same one for the same id). */
export function Thumb({ id, url, className = "", children }: { id: string; url?: string | null; className?: string; children?: React.ReactNode }) {
  const src = assetUrl(url ?? null);
  return (
    <Photo className={cn("shrink-0", className)} style={{ background: placeholderFor(id) }}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" />
      )}
      {children}
    </Photo>
  );
}
