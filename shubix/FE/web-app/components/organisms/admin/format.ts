/** Shared number and date wording for the admin dashboard. */
import { formatRelative } from "@/lib/format";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const rupees = (n: number) => inr.format(n);
export const count = (n: number) => n.toLocaleString("en-IN");

/** "5 min ago" (the app's own wording, lib/format.ts) */
export const ago = (iso: string | null | undefined) => (iso ? formatRelative(iso) : "—");

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

/** A page path as people know it ("/" is Home). */
export const page = (path: string) => (path === "/" ? "Home" : path.replace(/^\//, "").replace(/\/[0-9a-f]{24}/g, "/…"));
