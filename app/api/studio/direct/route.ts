import { body } from "@/server/core/body";
import { requireFeature } from "@/server/core/features";
import { route } from "@/server/core/http";
import { recordRun, taste } from "@/server/studio/brain";
import { direct, DirectIn } from "@/server/studio/direct";

/** Fast Studio's AI director: for every cut, which offered moment, its transition, effect, speed and the keyframes on
 * its hits, decided from the music map and the footage. The phone checks that each choice can be played. */
export const POST = route(async (req) => {
  await requireFeature(req, "studioAI");
  const d = await body(req, DirectIn), t0 = Date.now();
  try {
    const res = await direct(d, undefined, await taste());
    recordRun({ kind: "plan", cuts: d.slots.length, mode: d.mode, provider: res.provider, model: res.model, ms: Date.now() - t0, ok: true,
      transitions: res.slots.filter((s) => s.transition && s.transition !== "hard").length,
      effects: res.slots.filter((s) => s.effect && s.effect !== "none").length, keys: res.slots.reduce((n, s) => n + s.keys.length, 0) });
    return res;
  } catch (e) {
    recordRun({ kind: "plan", cuts: d.slots.length, mode: d.mode, provider: "", model: "", ms: Date.now() - t0, ok: false });
    throw e;
  }
});
