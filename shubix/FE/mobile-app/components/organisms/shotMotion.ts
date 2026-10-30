import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import type { ProjectClip } from "@shubix/validations";
import { evaluateTransformKeyframes } from "@shubix/video-engine";

/** The studio's transitions and effects in the editor's preview (FE/web-app components/studio/engine.ts: TR_NAME,
 * TR_DUR, keyframesFor), drawn natively: the shot comes in with its transition (a flash, a dip, a push, a zoom…) and
 * moves with its effect (a punch, a shake, a slow drift, a pulse on the beat). The preview plays one shot at a time,
 * so a transition shows the new shot arriving (a dissolve or a mask as a soft dip); the export draws them exactly. */

// a transition's length (seconds) as the studio's TR_DUR, and how the preview draws it
const TR: Record<string, [number, Draw]> = {};
type Draw = "flash" | "burn" | "dip" | "soft" | "left" | "right" | "up" | "down" | "drop" | "zoom" | "zoomout" | "spin" | "flip" | "glitch";
const add = (d: Draw, len: number, ...names: string[]) => names.forEach((n) => { TR[n] = [len, d]; });
add("flash", 0.22, "flash"); add("burn", 0.4, "burn"); add("dip", 0.26, "dip"); add("dip", 0.35, "fadein", "fade");
add("soft", 0.35, "dissolve", "blur", "luma", "pixelate", "ripple", "iris", "wipe", "bars", "diamond", "heart", "star", "clock", "doors");
add("left", 0.16, "whip"); add("left", 0.24, "slideleft", "push"); add("right", 0.24, "slideright"); add("up", 0.24, "slideup");
add("up", 0.2, "swipeup"); add("down", 0.24, "slidedown"); add("drop", 0.32, "dropin"); add("zoom", 0.18, "zoom"); add("zoomout", 0.3, "zoomout");
add("spin", 0.2, "spin"); add("flip", 0.3, "flip"); add("glitch", 0.14, "glitch");

// an effect: a punch in (scale from, seconds), a slow move over the shot, a shake, a pulse on the beat, a flash
const PUNCH: Record<string, [number, number]> = { punch: [1.3, 0.45], zoomburst: [1.32, 0.45], hook: [1.4, 0.55], jump: [1.25, 0.3], tilt: [1.25, 0.45], "punch-soft": [1.12, 0.6] };
const DRIFT = new Set(["pan", "pan-soft", "drift"]);
const PULSE = new Set(["bounce", "boxgrow", "grid", "strips", "circle", "heartbeat", "starbeat", "strobe", "rgbpulse", "blurpulse"]);

const timing = (v: Animated.Value, to: number, s: number, easing = Easing.out(Easing.cubic)) => Animated.timing(v, { toValue: to, duration: s * 1000, easing, useNativeDriver: true });

/** The preview's motion for a shot: `content` goes on the picture, `veil` on a layer over it (its colour: `veilColor`).
 * Starts when the shot starts playing (`at`: where in the shot; a shot played from its middle shows no transition). */
export function useShotMotion(clip: ProjectClip | undefined, playing: boolean, at: number, width: number, beat = 0.5) {
  const v = useRef({ x: new Animated.Value(0), y: new Animated.Value(0), s: new Animated.Value(1), r: new Animated.Value(0), sx: new Animated.Value(1), o: new Animated.Value(0), kx: new Animated.Value(0), ky: new Animated.Value(0), ks: new Animated.Value(1), kr: new Animated.Value(0), ko: new Animated.Value(1) }).current;
  useEffect(() => {
    const reset = () => { v.x.setValue(0); v.y.setValue(0); v.s.setValue(1); v.r.setValue(0); v.sx.setValue(1); v.o.setValue(0); };
    reset();
    if (!clip || !playing) return;
    const steps: Animated.CompositeAnimation[] = [];
    const tr = at < 0.08 ? TR[clip.transition.toLowerCase()] : undefined;
    if (tr) {
      const [len, draw] = tr, w = width;
      const from: Partial<Record<keyof typeof v, number>> = {
        flash: { o: 1 }, burn: { o: 0.9 }, dip: { o: 1 }, soft: { o: 0.55 }, left: { x: w }, right: { x: -w }, up: { y: w * 1.6 }, down: { y: -w * 1.6 },
        drop: { y: -w * 0.5 }, zoom: { s: 1.35 }, zoomout: { s: 0.7 }, spin: { r: -1, s: 1.2 }, flip: { sx: 0 }, glitch: { x: 14, o: 0.3 },
      }[draw];
      (Object.keys(from) as (keyof typeof v)[]).forEach((k) => { v[k].setValue(from[k]!); steps.push(timing(v[k], k === "s" || k === "sx" ? 1 : 0, len, draw === "drop" ? Easing.bounce : undefined)); });
    }
    const fx = clip.effect ?? "", len = Math.max(0.2, (clip.end - clip.start) / clip.speed - at);
    if (PUNCH[fx] && at < 0.08) {
      const [s, t] = PUNCH[fx];
      if (!tr) v.s.setValue(s);
      steps.push(Animated.sequence([Animated.delay(tr ? tr[0] * 1000 : 0), timing(v.s, 1, t, Easing.out(Easing.exp))]));
      if (fx === "tilt") { v.r.setValue(0.04); steps.push(timing(v.r, 0, t)); }
    } else if (DRIFT.has(fx)) steps.push(timing(v.s, fx === "pan-soft" ? 1.06 : 1.12, len, Easing.linear));
    else if (fx === "shake") steps.push(Animated.loop(Animated.sequence([-6, 6, -4, 4, 0].map((x) => timing(v.x, x, 0.05, Easing.linear))), { iterations: Math.ceil(len / 0.5) }));
    else if (PULSE.has(fx)) steps.push(Animated.loop(Animated.sequence([timing(v.s, 1.06, 0.08), timing(v.s, 1, Math.max(0.1, beat - 0.08))]), { iterations: Math.ceil(len / beat) }));
    else if (fx === "snap" && at < 0.08) { v.o.setValue(1); steps.push(timing(v.o, 0, 0.14)); }
    const run = Animated.parallel(steps);
    run.start();
    return () => { run.stop(); reset(); };
  }, [clip?.id, clip?.transition, clip?.effect, playing]); // eslint-disable-line react-hooks/exhaustive-deps
  // Shared Studio keyframes are also evaluated in the native preview, not only during MP4 export.
  useEffect(() => {
    const frames = clip?.keyframes;
    if (!frames?.length) { v.kx.setValue(0); v.ky.setValue(0); v.ks.setValue(1); v.kr.setValue(0); v.ko.setValue(1); return; }
    const current = evaluateTransformKeyframes(frames, Math.max(0, at));
    v.kx.setValue(current.x * width);
    v.ky.setValue(current.y * 360);
    v.ks.setValue(current.s);
    v.kr.setValue(current.r / 90);
    v.ko.setValue(current.o);
  }, [clip?.id, clip?.keyframes, at, width]); // eslint-disable-line react-hooks/exhaustive-deps
  // the veil's colour: white for a flash (and a photo snap), warm for a film burn, else black
  const draw = clip && TR[clip.transition.toLowerCase()]?.[1];
  const color = draw === "burn" ? "#ff9a3c" : draw === "flash" || (!draw && clip?.effect === "snap") ? "#fff" : "#000";
  return {
    content: { opacity: v.ko, transform: [{ translateX: v.x }, { translateY: v.y }, { scale: v.s }, { scaleX: v.sx }, { rotate: v.r.interpolate({ inputRange: [-1, 1], outputRange: ["-90deg", "90deg"] }) }, { translateX: v.kx }, { translateY: v.ky }, { scale: v.ks }, { rotate: v.kr.interpolate({ inputRange: [-1, 1], outputRange: ["-90deg", "90deg"] }) }] },
    veil: { opacity: v.o, backgroundColor: color },
  };
}
