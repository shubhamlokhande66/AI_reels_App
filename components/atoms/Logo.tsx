// The Shubix logo with its name (logo/ → public/brand, scripts/brand-assets.mjs): the gold S with the play button and the
// brain, SHUBIX and "Brain reels maker" under it, as designed, on its clear ground. The browser tab uses the emblem alone.
/* eslint-disable @next/next/no-img-element -- a small static picture; no image optimisation needed */
export function Logo({ height = 40, className = "" }: { height?: number; className?: string }) {
  return (
    <img
      src={height > 60 ? "/brand/shubix-gold.webp" : "/brand/shubix-gold-sm.webp"}
      alt="Shubix · Reels video studio"
      height={height}
      width={Math.round(height * 1.36)}
      className={`block select-none ${className}`}
      style={{ height, width: "auto" }}
      draggable={false}
    />
  );
}

/** The logo on its own dark tile, for a page of its own (sign-in, Contact) in the light look too. */
export function LogoTile({ height = 64 }: { height?: number }) {
  return (
    <span className="inline-flex rounded-2xl bg-[#10100f] px-4 py-3 shadow-[0_18px_40px_-24px_rgba(0,0,0,.6)]">
      <Logo height={height} />
    </span>
  );
}
