// The Shubix logo (public/brand): the film-ribbon S, SHUBIX and "Reels video studio", gold on black.
/* eslint-disable @next/next/no-img-element -- a small static picture; no image optimisation needed */
export function Logo({ height = 40, className = "" }: { height?: number; className?: string }) {
  return (
    <img
      src={height > 56 ? "/brand/shubix-logo.webp" : "/brand/shubix-logo-sm.webp"}
      alt="Shubix · Reels video studio"
      height={height}
      width={Math.round(height * 2.53)}
      className={`block select-none ${className}`}
      style={{ height, width: "auto" }}
      draggable={false}
    />
  );
}

/** The logo on a black tile, for light (Ivory) pages. */
export function LogoTile({ height = 64 }: { height?: number }) {
  return (
    <span className="inline-flex rounded-2xl bg-[#05060a] px-4 py-3 shadow-[0_18px_40px_-24px_rgba(0,0,0,.7)]">
      <Logo height={height} />
    </span>
  );
}
