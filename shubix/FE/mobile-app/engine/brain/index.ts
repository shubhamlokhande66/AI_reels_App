// The brain in one place: it can make a Reel from a copy of the engine's state, anywhere JavaScript runs (the hidden page, Node
// in the golden test, the app's own engine on the phone). The state copy never touches the Reel the person is editing.
// @ts-nocheck
import { createEditBrain } from "./edit";
import { createCoreBrain } from "./core";
import { createReelBrain } from "./reel";
import { createSharedBrain } from "./shared";
import { createAiBrain } from "./ai";
import { createSmallBrain } from "./small";
import { createChatBrain } from "./chat";

/** all the brain's parts on one state; what is not in the brain comes from `values` (plain data), else it is a page job, which does nothing here */
export function createBrain(ES, values = {}) {
  const parts = {}, pageJobs = new Map();
  const EH = new Proxy({}, { get: (_, name) => {
    for (const part of Object.values(parts)) if (part[name] !== undefined) return part[name];
    if (name in values) return values[name];
    return () => { pageJobs.set(name, (pageJobs.get(name) || 0) + 1); };
  } });
  Object.assign(parts, { chat: createChatBrain(ES, EH), small: createSmallBrain(ES, EH), shared: createSharedBrain(ES, EH), edit: createEditBrain(ES, EH), core: createCoreBrain(ES, EH), reel: createReelBrain(ES, EH), ai: createAiBrain(ES, EH) });
  return { ...parts.chat, ...parts.small, ...parts.shared, ...parts.edit, ...parts.core, ...parts.ai, ...parts.reel, ES, pageJobs };
}

const isPagePart = (v) => (typeof Node !== "undefined" && v instanceof Node) || (typeof CanvasRenderingContext2D !== "undefined" && v instanceof CanvasRenderingContext2D);

/** the engine's state and its plain values as text (in the page). A shot's speed is a function: it travels by name. */
export function copyOfState(ES, HOOKS) {
  const seen = new WeakSet(), speedKey = HOOKS.core.speedKey;
  const dump = (k, v) => {
    if (k === "sp" && v && typeof v.pos === "function") return { __sp: speedKey(v) };
    if (typeof v === "function" || isPagePart(v)) return undefined;
    if (ArrayBuffer.isView(v)) return { __t: v.constructor.name, v: Array.from(v) };
    if (typeof AudioBuffer !== "undefined" && v instanceof AudioBuffer) return { __t: "AudioBuffer", duration: v.duration, length: v.length, sampleRate: v.sampleRate, numberOfChannels: v.numberOfChannels };
    if (v instanceof Map) return { __t: "Map", v: [...v] };
    if (v instanceof Set) return { __t: "Set", v: [...v] };
    if (v && typeof v === "object") { if (seen.has(v)) return undefined; seen.add(v); }
    return v;
  };
  const values = {};
  for (const group of Object.values(HOOKS)) for (const k of Object.keys(group)) { try { const v = group[k]; if (typeof v !== "function" && v !== undefined) values[k] = v; } catch (e) { /* not made yet */ } }
  return JSON.stringify({ ES, values }, dump);
}

/** a brain on a state copy (speeds back from their names); `values`: its plain values, which the caller may change */
export function brainFromCopy(copy) {
  const typed = { Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Int16Array, Int32Array, Uint16Array, Uint32Array };
  const revive = (k, v) => {
    if (!v || !v.__t) return v;
    if (v.__t === "Map") return new Map(v.v);
    if (v.__t === "Set") return new Set(v.v);
    return typed[v.__t] ? new typed[v.__t](v.v) : v;
  };
  const { ES, values } = JSON.parse(copy, revive), brain = createBrain(ES, values);
  const speeds = (o, seen = new Set()) => { if (!o || typeof o !== "object" || seen.has(o)) return; seen.add(o); if (o.sp && o.sp.__sp !== undefined) o.sp = brain.speedFor(o.sp.__sp, o); for (const v of Array.isArray(o) ? o : Object.values(o)) speeds(v, seen); };
  speeds(ES);
  return { ...brain, values };
}

/** makes the Reel from a state copy, with no page: its shots (start, end, clip, in, transition, effect) */
export const shotsOf = (ES) => { const rounded = (v) => (typeof v === "number" ? +v.toFixed(3) : v); return ES.edit.map((e) => [e.start, e.end, e.src, e.in, e.tr, e.efx].map(rounded)); };
export function reelFromCopy(copy) {
  const brain = brainFromCopy(copy);
  brain.makeEditNow();
  return { shots: shotsOf(brain.ES), pageJobs: [...brain.pageJobs.keys()] };
}
