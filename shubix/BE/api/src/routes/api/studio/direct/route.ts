import { trendText } from "../../../../server/studio/styles";
import { isPlanAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { balanceNow, chargeOnce, chatTurn, requireAiPlan } from "../../../../server/credits";
import { chatSize } from "@shubix/core/lib/chatSize";
import { requireFeature } from "../../../../server/core/features";
import { route } from "../../../../server/core/http";
import { recordRun, taste } from "../../../../server/studio/brain";
import { direct, DirectIn, directPatch, directVariants } from "../../../../server/studio/direct";
import { limits } from "../../../../server/core/rateLimit";

/** Fast Studio's AI director: for every cut, which offered moment, its transition, effect, speed and the keyframes on
 * its hits, decided from the music map and the footage. The phone checks that each choice can be played. */
export const POST = route(async (req) => {
  await requireFeature(req, "studioAI");
  await requireAiPlan(await isPlanAdmin(req), { credits: true }); // paid with credits: Free may use it with credits (Admin → Marketing)
  limits.ai(req); // each AI call costs money
  const d = await body(req, DirectIn), t0 = Date.now();
  // the Reel's AI (once per Reel), then the chat message it answers (once per message: small or the whole Reel)
  if (d.reelId) await chargeOnce("studio_ai", d.reelId, "Shubix AI Reel");
  // the plan's first chat changes on a Reel are free (Editor 2, Pro 5); the rest use credits
  const chatCharge = d.chat && d.reelId ? await chatTurn(d.reelId, d.chat.id || `n${d.chat.n}`, chatSize(d.chat.text) === "small" ? "studio_chat_small" : "studio_chat_big", "Ask Shubix: " + d.chat.text.slice(0, 60)) : null;
  const chatOut = chatCharge ? { chat: { free: chatCharge.free, used: chatCharge.used, left: chatCharge.left, charged: chatCharge.taken } } : {};
  if (d.patch) {
    try { const res = await directPatch(d, undefined, await taste()); recordRun({ kind: "plan", cuts: res.slots.length, mode: d.mode, provider: res.provider, model: res.model, ms: Date.now() - t0, ok: true }); return { ...res, ...chatOut, balance: await balanceNow() }; }
    catch (e) { await chatCharge?.undo(); throw e; }
  }
  if (d.variants) {
    if (d.reelId) await chargeOnce("studio_mix", `${d.reelId}:mix:${d.slots.length}:${d.slots.map((s) => s.t.toFixed(1)).join(",").slice(0, 120)}`, "Change Reel: Shubix's versions");
    // New mix: other plans for the same cuts, in one call
    try {
      const res = await directVariants(d, undefined, await taste(), await trendText(d.reelKind));
      recordRun({ kind: "mix", cuts: d.slots.length, mode: d.mode, provider: res.provider, model: res.model, ms: Date.now() - t0, ok: true });
      return res;
    } catch (e) {
      recordRun({ kind: "mix", cuts: d.slots.length, mode: d.mode, provider: "", model: "", ms: Date.now() - t0, ok: false });
      throw e;
    }
  }
  try {
    const res = await direct(d, undefined, await taste(), await trendText(d.reelKind)).catch(async (e) => { await chatCharge?.undo(); throw e; });
    recordRun({ kind: "plan", cuts: d.slots.length, mode: d.mode, provider: res.provider, model: res.model, ms: Date.now() - t0, ok: true,
      transitions: res.slots.filter((s) => s.transition && s.transition !== "hard").length,
      effects: res.slots.filter((s) => s.effect && s.effect !== "none").length, keys: res.slots.reduce((n, s) => n + s.keys.length, 0) });
    return { ...res, ...chatOut, balance: await balanceNow() };
  } catch (e) {
    recordRun({ kind: "plan", cuts: d.slots.length, mode: d.mode, provider: "", model: "", ms: Date.now() - t0, ok: false });
    throw e;
  }
});
