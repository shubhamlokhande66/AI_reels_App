"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// The phone top bar (designs: back or menu · page title · an action or the credits). Pages give it a title of their
// own (a project's name) and an action (Upload, Render …) with these helpers; the shell draws it.

let title: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The page's own title in the top bar (e.g. the project's name) while the page is open. */
export function useTopTitle(t: string | null | undefined) {
  useEffect(() => {
    if (!t) return;
    title = t;
    emit();
    return () => {
      title = null;
      emit();
    };
  }, [t]);
}

export function useCustomTitle(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => title,
    () => null,
  );
}

const DESKTOP = "(min-width: 768px)";
/** True on a computer-sized window (the sidebar layout), false on a phone. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (fn) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const m = window.matchMedia(DESKTOP);
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(DESKTOP).matches,
    () => false,
  );
}

export const TOP_SLOT = "rm-top-action";

/** A button for the phone top bar's right corner (it replaces the credits there). On a computer it shows in place. */
export function TopAction({ children }: { children: React.ReactNode }) {
  const desktop = useIsDesktop();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (desktop) return <>{children}</>;
  if (!hydrated) return null;
  const slot = document.getElementById(TOP_SLOT);
  return slot ? createPortal(children, slot) : <>{children}</>; // no top bar (a page on its own): in place
}
