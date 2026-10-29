import { buttonClass, iconButtonClass } from "@shubix/ui-web";

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
