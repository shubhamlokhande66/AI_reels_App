import { buttonClass, chipClass, iconButtonClass, segClass, tileClass } from "@shubix/ui-web";

/** The studio's building blocks, as Tailwind classes for its HTML strings: the website's own (Shared/ui-web), so the
 * studio looks like the rest of the app. Size or place is added where one is used: class="${Button.icon} size-11". */
export const Button = {
  primary: buttonClass(),
  secondary: buttonClass({ variant: "secondary" }),
  small: buttonClass({ variant: "secondary", size: "sm" }),
  ghost: buttonClass({ variant: "ghost" }),
  danger: buttonClass({ variant: "danger" }),
  large: buttonClass({ variant: "secondary", size: "lg", full: true }),
  primaryLarge: buttonClass({ size: "lg", full: true }),
  // only an icon: grey (undo, redo), bordered (back, close a panel), primary (send, apply), close (the ✕ of a pop-up)
  icon: iconButtonClass("muted"),
  iconBordered: iconButtonClass(),
  iconPrimary: iconButtonClass("main"),
  close: `${iconButtonClass("muted")} size-8 hover:bg-surface-2`,
};

/** A chip (chosen: aria-pressed="true"); `chip` stays as the name the code looks for. */
export const Chip = `chip ${chipClass()}`;

/** A segmented control (one of a few side by side); small: one compact line; wide: the whole width, shared. */
export const Segmented = {
  normal: segClass(),
  small: segClass(true),
  wide: `${segClass()} grid w-full grid-cols-[repeat(auto-fit,minmax(0,1fr))] *:min-h-11 *:whitespace-nowrap`,
};

/** A tool tile: an icon over its name (chosen: aria-pressed="true"). */
export const Tile = tileClass;
