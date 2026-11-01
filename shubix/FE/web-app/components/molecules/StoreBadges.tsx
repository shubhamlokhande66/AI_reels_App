"use client";


import { useText } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { useSite } from "@/components/molecules/Legal";

/** "Get it on Google Play" / "Download on the App Store", like other brands show them. The links are the administrator's
 * (Admin → Settings → Business details); a store without a link shows "Coming soon" and is not a link. Hidden inside
 * the phone app itself. `compact`: the sidebar and the menu: "Get the app" over two small badges side by side. */
export function StoreBadges({ compact = false, className }: { compact?: boolean; className?: string }) {
  const text = useText(), site = useSite().data;
  if (!site) return null;
  const stores = [
    { id: "play", url: site.playStoreUrl, top: text("store.playTop"), name: text("store.play"), logo: <PlayLogo /> },
    { id: "apple", url: site.appStoreUrl, top: text("store.appleTop"), name: text("store.apple"), logo: <AppleLogo /> },
  ];
  const badges = (
    <div className={cn(compact ? "grid grid-cols-2 gap-1.5" : "flex flex-wrap gap-2", !compact && className)}>
      {stores.map((s) => {
        const soon = !s.url;
        const inner = compact ? (
          <>
            <span className="h-[18px] w-[18px] shrink-0">{s.logo}</span>
            <span className="flex min-w-0 flex-col leading-none">
              <span className="truncate text-[10px] font-medium uppercase tracking-[0.05em] opacity-90">{soon ? text("store.soonShort") : s.top}</span>
              <span className="mt-[3px] truncate text-[11.5px] font-semibold tracking-[-0.01em]">{s.name}</span>
            </span>
          </>
        ) : (
          <>
            <span className="h-7 w-7 shrink-0">{s.logo}</span>
            <span className="flex min-w-0 flex-col leading-none">
              <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] opacity-85">{soon ? text("store.soon") : s.top}</span>
              <span className="mt-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{s.name}</span>
            </span>
          </>
        );
        const look = cn(
          "relative flex items-center gap-2 rounded-xl border border-white/20 bg-black text-white shadow-[0_6px_18px_rgba(0,0,0,.22)] transition-[transform,border-color] duration-200",
          compact ? "h-10 min-w-0 gap-1.5 rounded-lg border-white/15 px-2 shadow-none" : "h-[52px] min-w-[168px] px-3.5",
          soon ? "cursor-default opacity-60" : "hover:-translate-y-0.5 hover:border-white/45",
        );
        return soon ? (
          <span key={s.id} className={look} aria-label={`${s.name}: ${text("store.soon")}`}>{inner}</span>
        ) : (
          <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className={look} aria-label={`${s.top} ${s.name}`}>{inner}</a>
        );
      })}
    </div>
  );
  if (!compact) return badges;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="px-0.5 text-[11px] font-semibold text-muted">{text("store.title")}</span>
      {badges}
    </div>
  );
}

/** Home's "Get the app" band: the title, a line and the two badges. */
export function GetAppSection() {
  const text = useText();
  return (
    <section aria-labelledby="getapp-h" className="relative flex flex-col items-start gap-4 overflow-hidden rounded-3xl border border-border bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_18%,var(--surface)),var(--surface)_60%)] p-5 md:flex-row md:items-center md:justify-between md:p-7">
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(closest-side,rgba(216,189,123,.2),transparent)]" />
      <div className="relative min-w-0">
        <h2 id="getapp-h" className="m-0 font-display text-[20px] font-semibold tracking-[-0.01em] md:text-[24px]">{text("store.title")}</h2>
        <p className="m-0 mt-1 max-w-md text-[13.5px] text-muted">{text("store.sub")}</p>
      </div>
      <StoreBadges className="relative" />
    </section>
  );
}

const PlayLogo = () => (
  <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
    <path fill="#00C3FF" d="M3.6 2.2 13.4 12l-9.8 9.8c-.3-.2-.5-.6-.5-1.1V3.3c0-.5.2-.9.5-1.1Z" />
    <path fill="#00E676" d="m16.7 8.7-3.3 3.3-9.8-9.8c.3-.2.8-.2 1.3.1l11.8 6.4Z" />
    <path fill="#FF3D57" d="m16.7 15.3-11.8 6.4c-.5.3-1 .3-1.3.1l9.8-9.8 3.3 3.3Z" />
    <path fill="#FFD400" d="M20.4 10.7c.9.5.9 2 0 2.5l-3.7 2.1-3.3-3.3 3.3-3.3 3.7 2Z" />
  </svg>
);
const AppleLogo = () => (
  <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor" aria-hidden>
    <path d="M16.37 1.43c0 1.14-.49 2.27-1.18 3.08-.74.9-1.99 1.57-2.99 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.57-2.27 1.21-2.98.8-.94 2.14-1.64 3.25-1.68.03.13.05.28.05.43Zm4.56 15.71c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.94 2.71-3.43 2.71-1.52 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8-1.29-1.82-2.32-4.63-2.32-7.28 0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.68.95 3.6.95.87 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45Z" />
  </svg>
);
