/** Short pop-up notes after an action (bottom of the screen, a few seconds): "Saved", "Deleted", or what went wrong.
 * React code calls toast.success / toast.error; the studio engine (plain script) can send the same note with
 * window.dispatchEvent(new CustomEvent("shubix-toast", { detail: { kind, text } })). <Toaster/> shows them. */
export type ToastKind = "success" | "error" | "info";
export type Toast = { id: number; kind: ToastKind; text: string };

let items: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeToasts(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
export const toastList = () => items;

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, text: string) {
  if (!text) return;
  // the same note twice in a row (two parts of a page failing alike) shows once
  if (items.some((t) => t.text === text && t.kind === kind)) return;
  const t = { id: next++, kind, text };
  items = [...items.slice(-2), t];
  emit();
  setTimeout(() => dismissToast(t.id), kind === "error" ? 6000 : 3200);
}

export const toast = {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  info: (text: string) => push("info", text),
};

if (typeof window !== "undefined") {
  window.addEventListener("shubix-toast", (e) => {
    const d = (e as CustomEvent<{ kind?: ToastKind; text?: string }>).detail;
    if (d?.text) push(d.kind ?? "info", d.text);
  });
}
