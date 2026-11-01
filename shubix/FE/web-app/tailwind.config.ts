import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { tailwindPreset } from "@shubix/ui-web";

/** The website's Tailwind, like the phone's (FE/mobile-app/tailwind.config.js): the design is Shared/ui-web's preset;
 * here only the rules of this app's own shell (.rm, components/templates/AppShell.tsx) and its busy buttons. */
const GOLD = '.rm :is(button, a)[class~="bg-gold"]';
const BUSY = ':is(button, [role="button"])[aria-busy="true"], a.btn[aria-busy="true"]';
/** the pages' sections arrive one after another ("backwards", not "both": a transform kept after it ends would hold
 * every fixed bar or sheet inside the section) */
const ARRIVING = ".rm main > div > div > :is(section, article), .rm main > div > div > div > :is(section, article)";

export default {
  presets: [tailwindPreset],
  plugins: [
    plugin(({ addBase }) => addBase({
      ".rm": { fontFamily: "var(--font-body), system-ui, sans-serif" },
      ".rm a:not(.brs *)": { color: "inherit", textDecoration: "none" },
      'form[role="search"] input:focus-visible': { outline: "none" }, // a search box shows focus on its own border
      // the app's panels: the design's shadow; fields ease their focus; a gold button's passing light
      '.rm :is([class*="rounded-2xl"], [class*="rounded-3xl"])[class*="border"][class*="bg-surface"]:not(button, input, select)': { boxShadow: "var(--shadow)", transition: "border-color 220ms ease, box-shadow 260ms ease, translate 260ms cubic-bezier(.2,.75,.25,1)" },
      '.rm aside[class~="md:fixed"]': { boxShadow: "12px 0 40px -34px rgba(0, 0, 0, .75)" },
      '.rm :is(input:not([type="checkbox"], [type="radio"]), select, textarea)': { transition: "border-color 180ms ease, box-shadow 220ms ease, background-color 220ms ease" },
      [GOLD]: { position: "relative", overflow: "hidden", isolation: "isolate" },
      [`${GOLD} > *`]: { position: "relative", zIndex: "2" },
      [`${GOLD}::after`]: { content: '""', position: "absolute", zIndex: "1", inset: "0", pointerEvents: "none", opacity: "0", background: "linear-gradient(110deg, transparent 25%, rgba(255,255,255,.2) 48%, transparent 70%)", transform: "translateX(-130%)", transition: "transform 700ms ease, opacity 180ms ease" },
      [`${GOLD}:hover::after`]: { opacity: "1", transform: "translateX(130%)" },
      [ARRIVING]: { animation: "enter 480ms cubic-bezier(.2,.7,.25,1) backwards" },
      ...Object.fromEntries([2, 3, 4].map((n) => [`.rm main > div > div > section:nth-of-type(${n}), .rm main > div > div > div > section:nth-of-type(${n})`, { animationDelay: `${(n - 1) * 45}ms` }])),
      // a button whose server action is on its way (lib/activity.ts sets aria-busy): a spinner, and no second click
      [BUSY]: { pointerEvents: "none !important", opacity: "0.85 !important" },
      ':is(button, [role="button"])[aria-busy="true"]:not([data-loading])::before, a.btn[aria-busy="true"]::before': { content: '""', display: "inline-block", flexShrink: "0", width: "1em", height: "1em", marginRight: "0.5em", verticalAlign: "-0.15em", border: "2px solid currentColor", borderRightColor: "transparent", borderRadius: "999px", animation: "spin 0.7s linear infinite" },
      'button.ib[aria-busy="true"]:not([data-loading]) > svg': { display: "none" }, // an icon button: the spinner takes the icon's place
      'button.ib[aria-busy="true"]:not([data-loading])::before': { marginRight: "0" },
      "@media (prefers-reduced-motion: reduce)": { [ARRIVING]: { animation: "none !important" }, ".rm *, .rm *::before, .rm *::after": { scrollBehavior: "auto !important", transitionDuration: "0.01ms !important" } },
    })),
  ],
} satisfies Config;
