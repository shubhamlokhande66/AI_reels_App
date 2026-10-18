// The Shubix logo (logo/ → public/brand): the neon film-ribbon S, SHUBIX and "Reels video studio", on a clear
// background (it reads on the dark and the light look). The installed app's icons are made from the same picture.
/* eslint-disable @next/next/no-img-element -- a small static picture; no image optimisation needed */
export function Logo({ height = 40, className = "" }: { height?: number; className?: string }) {
  return (
    <img
      src={height > 60 ? "/brand/shubix-logo.webp" : "/brand/shubix-logo-sm.webp"}
      alt="Shubix · Reels video studio"
      height={height}
      width={height * 2}
      className={`block select-none ${className}`}
      style={{ height, width: "auto" }}
      draggable={false}
    />
  );
}

/** The logo on its own dark tile, for a page of its own (sign-in, Contact) in the light look too. */
export function LogoTile({ height = 64 }: { height?: number }) {
  return (
    <span className="inline-flex rounded-2xl bg-[#0a0a1f] px-4 py-3 shadow-[0_18px_40px_-24px_rgba(0,0,0,.6)]">
      <Logo height={height} />
    </span>
  );
}
