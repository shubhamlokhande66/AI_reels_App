import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { cssVars, dark, light } from "./palette";

/** The website's Tailwind preset (FE/web-app/tailwind.config.ts uses it): the theme's colours as variables (Dark by
 * default and on .noir, Light when chosen), the animations, and the page-wide element rules (base layer: a utility on
 * an element always wins over them). */
const v = (name: string) => `var(--${name})`;
const COLORS = ["background", "surface", "surface-2", "border", "foreground", "muted", "accent", "accent-hover", "on-accent", "success", "warning", "danger"];
const DATE = 'input:is([type="date"], [type="datetime-local"], [type="time"], [type="month"])';

export default {
  theme: {
    extend: {
      colors: { ...Object.fromEntries(COLORS.map((c) => [c, v(c)])), edge: "color-mix(in srgb, var(--accent) 14%, var(--border))" }, // edge: a card's gold-tinted line
      backgroundImage: { gold: v("gold-gradient") },
      fontFamily: { sans: ["var(--font-body)", "system-ui", "sans-serif"], display: ["var(--font-display)", "system-ui", "sans-serif"], mono: ["var(--font-geist-mono)"] },
      borderRadius: { "3xl": "1rem" }, // the design's corners: cards 16, buttons 12
      keyframes: {
        eq: { "0%, 100%": { transform: "scaleY(0.3)" }, "50%": { transform: "scaleY(1)" } },
        wave: { from: { transform: "scaleY(.3)", opacity: ".5" }, to: { transform: "scaleY(1)", opacity: "1" } },
        enter: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        film: { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "-14px 0" } },
        stripes: { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "28px 0" } },
        spark: { "0%, 100%": { transform: "scale(0.85) rotate(0deg)", opacity: "0.75" }, "50%": { transform: "scale(1.1) rotate(12deg)", opacity: "1" } },
        rise: { "0%": { transform: "translateY(5px)", opacity: "0" }, "35%, 65%": { opacity: "1" }, "100%": { transform: "translateY(-5px)", opacity: "0" } },
        slide: { from: { transform: "translateX(-110%)" }, to: { transform: "translateX(260%)" } },
        sweep: { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(400%)" } },
        sheet: { from: { transform: "translateX(32px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "sheet-up": { from: { opacity: "0", transform: "translateY(10px) scale(0.985)" }, to: { opacity: "1", transform: "none" } },
        "shade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        pop: { from: { transform: "scale(0.92) translateY(6px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        glow: { "0%, 100%": { boxShadow: "0 0 12px 0 color-mix(in srgb, var(--accent) 35%, transparent)" }, "50%": { boxShadow: "0 0 22px 2px color-mix(in srgb, var(--accent) 60%, transparent)" } },
        drift: { from: { transform: "translate3d(-8px, 8px, 0) scale(.92)" }, to: { transform: "translate3d(14px, -12px, 0) scale(1.08)" } },
        breathe: { "0%, 100%": { transform: "scale(.96)", opacity: ".88" }, "50%": { transform: "scale(1.04)", opacity: "1" } },
        drop: { from: { opacity: "0", transform: "translateY(-4px)" } }, // a menu opening under its button
        spin: { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        eq: "eq 0.9s ease-in-out infinite",
        wave: "wave 1s ease-in-out infinite alternate", // a sound bar's beat
        enter: "enter 0.45s cubic-bezier(.2,.7,.25,1) both", // a card or form arriving
        film: "film 0.8s linear infinite",
        spark: "spark 1.4s ease-in-out infinite",
        rise: "rise 1.1s ease-in-out infinite",
        slide: "slide 1.3s ease-in-out infinite",
        sweep: "sweep 1.1s ease-in-out infinite", // the top activity bar
        sheet: "sheet 0.22s ease-out both", // a panel sliding in from the right
        "sheet-up": "sheet-up 0.24s cubic-bezier(0.2, 0.8, 0.25, 1) both", // a sheet rising from the bottom
        "shade-in": "shade-in 0.2s ease both", // a dialog's dimmed backdrop
        pop: "pop 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.25) both",
        progress: "stripes 1s linear infinite, glow 2.4s ease-in-out infinite", // a gold bar at work
        "progress-sheen": "sweep 1.8s ease-in-out infinite",
        drift: "drift 10s ease-in-out infinite alternate",
        drop: "drop .15s ease-out",
        breathe: "breathe 5s ease-in-out infinite",
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => addBase({
      ":root, .noir:not(.brs)": cssVars(dark),
      ':root[data-theme="light"]': cssVars(light),
      ".noir:not(.brs)": { colorScheme: "dark", color: v("foreground") }, // a part of a page that stays dark
      html: { colorScheme: "dark", "--font-display": v("font-body") }, // headings: the text's face, heavier
      'html[data-theme="light"]': { colorScheme: "light" },
      "html, body": { overflowX: "clip" }, // never a sideways-scrolling page
      body: { color: v("foreground"), fontFamily: "var(--font-sans)", letterSpacing: "0.005em", background: v("background") },
      // the page's soft glow, a fixed layer of its own (a fixed gradient on the body is repainted on every scroll frame)
      "body::before": { content: '""', position: "fixed", inset: "0", zIndex: "-1", pointerEvents: "none",
        background: "radial-gradient(1200px 600px at 85% -10%, var(--glow-1), transparent 60%), radial-gradient(900px 500px at -10% 110%, var(--glow-2), transparent 60%)" },
      "h1, h2, h3": { letterSpacing: "0.01em" },
      h2: { fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: "1.3em", fontWeight: "800", letterSpacing: "-0.01em" },
      "::selection": { background: "color-mix(in srgb, var(--accent) 35%, transparent)", color: "#fff" },
      ":focus-visible": { outline: `2px solid ${v("accent")}`, outlineOffset: "2px" },
      "input, select, textarea": { accentColor: v("accent") },
      "*": { scrollbarWidth: "thin", scrollbarColor: `${v("scrollbar")} transparent`, WebkitTapHighlightColor: "transparent" },
      ".grid > *, .flex > *": { minWidth: "0" }, // long names and URLs shrink instead of widening the page
      // every clickable thing says so; pressed: 1px down ("translate": a button placed with a transform keeps its place)
      'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), a[href], label[for], summary, select:not(:disabled), input:is([type="checkbox"], [type="radio"], [type="range"], [type="file"]):not(:disabled)': { cursor: "pointer" },
      "button:disabled, select:disabled, input:disabled": { cursor: "not-allowed" },
      "button:not(:disabled):active": { translate: "0 1px" },
      // date and time fields: as wide as their box; on touch screens the app's look, the value on the left
      [DATE]: { minWidth: "0", maxWidth: "100%", width: "100%" },
      "@media (pointer: coarse)": { [DATE]: { WebkitAppearance: "none", appearance: "none", display: "block", textAlign: "left", fontSize: "13.5px", lineHeight: "44px" }, [`${DATE}::-webkit-date-and-time-value`]: { textAlign: "left", margin: "0" } },
      "@media (max-width: 767px)": {
        // 16px text in fields: iPhones otherwise zoom in when one is tapped (important: it must win over smaller text sizes)
        'input:not([type="checkbox"], [type="radio"], [type="range"]), select, textarea': { fontSize: "16px !important" },
        'button[class*="px-"]': { minHeight: "40px" }, // comfortable tap targets
        "h1.font-display": { fontSize: "clamp(1.9rem, 8.5vw, 2.6rem)", lineHeight: "1.1" },
        '[class~="aspect-[9/16]"]': { maxWidth: "min(100%, calc(62svh * 9 / 16))", marginInline: "auto" }, // a Reel leaves its buttons in view
        "video, img, canvas": { maxWidth: "100%" },
      },
    })),
  ],
} satisfies Config;
