import { assetUrl } from "@/lib/api";
import { photoClass } from "./Icon";

/** A project's or clip's picture, else its warm placeholder (the same one for the same id). */
export function Thumb({ id, url, className = "", children }: { id: string; url?: string | null; className?: string; children?: React.ReactNode }) {
  const src = assetUrl(url ?? null);
  return (
    <div className={`photo ${photoClass(id)} shrink-0 ${className}`}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" />
      )}
      {children}
    </div>
  );
}
