import "server-only";
import { db, ObjectId } from "@/server/core/db";
import { round } from "@/server/core/py";
import type { Timeline } from "@/server/models/timeline";
import type { Operation } from "@/server/timeline/ops";

/** Anonymous edit feedback (was backend/app/services/feedback.py): the kind of event and a few numbers about the edit,
 * never names or text. The personal director profile is built from it (server/director, later). */

export const EVENTS = [
  "accepted", "rejected", "rejected_opening", "replaced_clip", "removed_shot", "changed_duration", "changed_style",
  "changed_pace", "removed_effect", "added_effect", "removed_transition", "added_transition", "changed_speed",
  "edited_text", "regenerated", "chose_concept",
] as const;
export const CONCEPTS = ["viral", "cinematic", "premium"];
type Facts = Record<string, string | number | boolean | null | undefined>;

export function editFacts(tl: Timeline): Facts {
  const n = tl.segments.length;
  const direction = (tl.creativePlan as { direction?: string } | null)?.direction;
  return {
    avgShot: round(tl.duration / Math.max(n, 1), 3), shots: n, duration: round(tl.duration, 2), style: tl.style,
    transitionRatio: round(tl.segments.slice(1).filter((s) => s.transitionIn.type !== "cut").length / Math.max(n - 1, 1), 3),
    effectRatio: round(tl.segments.filter((s) => s.effect !== "none").length / Math.max(n, 1), 3), texts: tl.overlays.length,
    concept: direction && CONCEPTS.includes(direction) ? direction : null,
  };
}

/** Store one event; feedback must never break an edit, so failures are only logged. */
export async function record(projectId: unknown, event: string, facts: Facts = {}): Promise<void> {
  if (!(EVENTS as readonly string[]).includes(event)) return;
  try {
    const pid = projectId instanceof ObjectId ? projectId : new ObjectId(String(projectId));
    const clean = Object.fromEntries(Object.entries(facts).filter(([, v]) => v === null || ["number", "string", "boolean"].includes(typeof v)));
    await (await db()).collection("feedback").insertOne({ projectId: pid, event, facts: clean, at: new Date() });
  } catch (e) {
    console.info(`feedback not recorded (${event}):`, e);
  }
}

/** What a manual edit says about the person's taste. */
export function eventsFromOps(tl: Timeline, ops: Operation[]): [string, Facts][] {
  const out: [string, Facts][] = [];
  const byId = new Map(tl.segments.map((s, i) => [s.id, [i, s] as const]));
  for (const op of ops) {
    const [i, seg] = byId.get((op as { segmentId?: string }).segmentId ?? "") ?? [null, null];
    if (op.type === "replace" || op.type === "delete") {
      if (i === 0) out.push(["rejected_opening", { how: op.type }]);
      else out.push([op.type === "replace" ? "replaced_clip" : "removed_shot", { position: i }]);
    } else if (op.type === "set_effect" && seg) {
      if (op.effect === "none" && seg.effect !== "none") out.push(["removed_effect", { effect: seg.effect }]);
      else if (op.effect !== "none" && seg.effect === "none") out.push(["added_effect", { effect: op.effect }]);
    } else if (op.type === "set_transition" && seg) {
      if (op.transition === "cut" && seg.transitionIn.type !== "cut") out.push(["removed_transition", { transition: seg.transitionIn.type }]);
      else if (op.transition !== "cut" && seg.transitionIn.type === "cut") out.push(["added_transition", { transition: op.transition }]);
    } else if (op.type === "set_speed") {
      out.push(["changed_speed", { speed: op.speed }]);
    } else if (op.type === "add_caption" || op.type === "update_caption" || op.type === "delete_caption") {
      out.push(["edited_text", { how: op.type }]);
    }
  }
  return out;
}

export async function recordOps(projectId: unknown, tl: Timeline, ops: Operation[]) {
  for (const [event, facts] of eventsFromOps(tl, ops)) await record(projectId, event, facts);
}

export async function recordSettingsChange(projectId: unknown, before: Record<string, unknown>, after: Record<string, unknown>) {
  for (const [key, event] of [["duration", "changed_duration"], ["style", "changed_style"], ["pace", "changed_pace"]] as const) {
    if (key in after && after[key] !== null && after[key] !== undefined && before[key] !== after[key]) {
      await record(projectId, event, { frm: before[key] as Facts[string], to: after[key] as Facts[string] });
    }
  }
}
