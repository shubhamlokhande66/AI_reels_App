import { buttonClass, chipClass, iconButtonClass, segClass, tileClass } from "@shubix/ui-web";

/** The studio's buttons: the website's one button (Shared/ui-web/src/button.ts) for the studio's HTML strings. */
export const B = {
  plain: buttonClass({ variant: "secondary" }),
  mini: buttonClass({ variant: "secondary", size: "sm" }),
  ghost: buttonClass({ variant: "ghost" }),
  main: buttonClass(),
  danger: buttonClass({ variant: "danger" }),
  big: buttonClass({ variant: "secondary", size: "lg", full: true }),
  mainBig: buttonClass({ size: "lg", full: true }),
  // icon only (its size where it is used): plain (undo, redo), boxed (back, close a panel), close (the ✕ of a pop-up)
  icon: `${iconButtonClass(true)} text-muted`,
  iconBox: iconButtonClass(),
  close: `${iconButtonClass(true)} size-8 text-muted hover:bg-surface-2`,
};

/** The studio's chips: the website's chip (chosen: aria-pressed="true"); `chip` stays as the name the code looks for. */
export const CHIP = `chip ${chipClass()}`;

/** The studio's segmented controls (the website's); `wide`: the whole width, buttons sharing it. */
export const SEG = segClass();
export const SEG_SM = segClass(true);
export const SEG_WIDE = `${segClass()} grid w-full grid-cols-[repeat(auto-fit,minmax(0,1fr))] *:min-h-11 *:whitespace-nowrap`;

/** The studio's tool tiles (the website's): an icon over its name. */
export const TILE = tileClass;
