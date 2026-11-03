import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useStudioText } from "@shubix/hooks";
import { asksForAllClips } from "@shubix/core/lib/chatSize";
import { Button, IconButton, Segmented, Slider, confirmAction, toast, useColors } from "@shubix/ui-mobile";
import { errorMessage } from "@shubix/api-client";
import { clipDuration, projectDuration, splitClip, type ProjectClip, type ReelProject } from "@shubix/validations";
import { evaluateAudioGain, evaluateSpeedRamp, recordEdit, slipClip, stepEditHistory } from "@shubix/video-engine";
import { getProject, keepPickedAssets, keepPickedFile, saveProject } from "../lib/projects";
import { pickSong } from "../lib/songs";
import { useLocked } from "../lib/data";
import { AskShubix, styleFromWords } from "../components/organisms/AskShubix";
import { ExportScreen } from "../components/organisms/ExportScreen";
import { pickInOrder } from "../components/organisms/Gallery";
import { isNativeEffectSupported, isNativeTransitionSupported, videoEngine } from "../lib/video";
import { engine, textsOf } from "../lib/engine";
import { TEXT_TEMPLATES } from "@shubix/core/lib/text-templates";
import { Choices, DOCK, Preview, SHOT_TOOLS, StudioBar, Timeline, ToolRow, ToolSheet, Transport } from "../components/organisms/EditorParts";

type Overlay = ReelProject["overlays"][number];
const FILTERS = ["Original", "Golden", "Film", "Noir", "Soft", "Vivid", "Cinematic", "Warm", "Cool", "Teal & Orange", "Sepia", "Matte", "High Contrast", "Faded", "Vintage", "Pastel", "Cyberpunk", "Dreamy", "Black & White", "Soft Focus", "Color Pop", "Muted", "Sunset", "Arctic"];
const TRANSITIONS = ["Cut", "Fade in", "Dissolve", "Whip pan", "Zoom", "Flash", "Glitch", "Dip to black", "Iris", "Soft wipe", "Spin", "Slide left", "Slide right", "Slide up", "Slide down", "Swipe up", "Zoom out", "Blur through", "Card flip", "Luma fade", "Pixelate", "Clock wipe", "Doors", "Ripple", "Film burn", "Drop in", "Bars wipe", "Diamond wipe", "Heart wipe", "Star wipe", "Stripes", "Blinds", "Checkerboard", "Dots", "Noise dissolve", "Split open", "Wave wipe", "Dip to white", "Colour split", "Random tiles", "Zoom blur", "Shake", "Squeeze", "Rotate in"];
const TRANSITION_IDS = ["hard", "fadein", "dissolve", "whip", "zoom", "flash", "glitch", "dip", "iris", "wipe", "spin", "slideleft", "slideright", "slideup", "slidedown", "swipeup", "zoomout", "blur", "flip", "luma", "pixelate", "clock", "doors", "ripple", "burn", "dropin", "bars", "diamond", "heart", "star", "stripes", "blinds", "checker", "dots", "noise", "splith", "wave", "dipwhite", "chroma", "tiles", "zoomblur", "shake", "squeeze", "rotatein"];
const EFFECTS = ["None", "Zoom punch", "Soft zoom", "Ken Burns", "Zoom burst", "Slow drift", "Shake", "Beat bounce", "Tilt punch", "Photo snap", "Hook zoom", "Punch-in (jump cut)", "Ken Burns beat", "Box pulse", "Grid pulse", "Strip pulse", "Circle pulse", "Heart pulse", "Star pulse", "Frame in frame", "Mirror", "Kaleidoscope", "Triple split", "VHS retro", "Strobe", "RGB pulse", "Blur pulse", "Film grain", "Light leak", "Rainbow", "Negative", "Halftone", "8-bit pixels", "CRT screen", "Fisheye", "Swirl", "Sketch", "Duotone", "3D zoom"];
const EFFECT_IDS = ["none", "punch", "punch-soft", "pan-soft", "zoomburst", "drift", "shake", "bounce", "tilt", "snap", "hook", "jump", "pan", "boxgrow", "grid", "strips", "circle", "heartbeat", "starbeat", "frame", "mirror", "kaleido", "triple", "vhs", "strobe", "rgbpulse", "blurpulse", "grain", "leak", "rainbow", "negative", "halftone", "pixel8", "crt", "fisheye", "swirl", "sketch", "duotone", "zoom3d"];
const UNAVAILABLE_TRANSITIONS = TRANSITIONS.filter((_, index) => !isNativeTransitionSupported(TRANSITION_IDS[index]));
const UNAVAILABLE_EFFECTS = EFFECTS.filter((_, index) => !isNativeEffectSupported(EFFECT_IDS[index]));
const SPEEDS = ["0.5×", "1×", "1.6×"];
const VOLUMES = ["0%", "25%", "50%", "75%", "100%"];
const STICKERS = ["✨", "🔥", "❤️", "😂", "🎉", "⭐", "👀", "💯", "😍", "🙏", "👑", "💥", "🎵", "📍", "✅", "🚀", "■", "●", "▲", "★", "♥", "◆", "➜", "━", "○", "□"];   // the last ten are shapes (in the text colour)
// the website's tool panels (components/studio/markup.ts): their choices, as its buttons' values and names
const MODES = [["auto", "Auto"], ["smooth", "Smooth"], ["fast", "Fast"]];
const MODE_HELP: Record<string, string> = {
  auto: "Auto: the music decides. Calm parts get longer shots, drops and hits get effects.",
  smooth: "Smooth: fewer, longer shots on the strong beats, soft camera moves, no flashy effects.",
  fast: "Fast: a cut on every beat, a transition on every cut, punches and speed changes on the hits.",
};
// …a look's filter when the phone makes the Reel
// the studio's 24 looks: [its key, the name, the phone preview's nearest filter]
const LOOKS = [["natural", "Natural", "Original"], ["vivid", "Vivid", "Vivid"], ["cine", "Cinematic", "Cinematic"], ["mono", "B&W", "Noir"], ["warmfilm", "Warm film", "Warm"], ["cool", "Cool", "Cool"], ["retro", "Retro", "Vintage"], ["moody", "Moody", "Muted"],
  ["wedding", "Wedding", "Dreamy"], ["golden", "Golden hour", "Golden"], ["tealorange", "Teal & orange", "Teal & Orange"], ["faded", "Faded", "Faded"], ["noir", "Noir", "Noir"], ["sepia", "Sepia", "Sepia"], ["cyber", "Cyber", "Cyberpunk"], ["pastel", "Pastel", "Pastel"],
  ["dramatic", "Dramatic", "High Contrast"], ["summer", "Summer", "Sunset"], ["night", "Night", "Arctic"], ["vintage", "Vintage", "Vintage"], ["matte", "Matte", "Matte"], ["punchy", "Punchy", "Color Pop"], ["forest", "Forest", "Muted"], ["rose", "Rose", "Soft"]];
// the studio's text styles, entrances, exits and loops (components/studio/engine.ts OV_STYLES, OV_ANIMS, OV_OUTS, OV_LOOPS)
const TX_STYLES = [["bold", "Bold"], ["box", "Box"], ["neon", "Neon"], ["clean", "Clean"], ["tag", "Tag"], ["outline", "Outline"], ["shadow", "Hard shadow"], ["bubble", "Bubble"], ["glow", "Glow"], ["stack", "Double outline"], ["cutout", "Video in letters"]];
const TX_INS = [["pop", "Pop"], ["fade", "Fade"], ["slide", "Slide up"], ["type", "Typewriter"], ["zoom", "Zoom in"], ["drop", "Drop in"], ["blur", "Blur in"], ["spin", "Spin in"], ["flicker", "Flicker"], ["glitch", "Glitch"], ["none", "None"]];
const TX_OUTS = [["none", "None"], ["fade", "Fade out"], ["pop", "Pop out"], ["slide", "Slide down"], ["zoom", "Zoom out"], ["blur", "Blur out"], ["spin", "Spin out"]];
const TX_LOOPS = [["none", "Still"], ["bounce", "Bounce"], ["spin", "Spin"], ["wiggle", "Wiggle"], ["pulse", "Pulse"], ["float", "Float"], ["swing", "Swing"], ["shake", "Shake"]];
const TX_COLORS = [["#FFFFFF", "White"], ["#111111", "Black"], ["#FFD54A", "Gold"], ["#FF4D6D", "Red"], ["#3DDC84", "Green"], ["#4DA3FF", "Blue"], ["#FF9F1C", "Orange"], ["#C77DFF", "Purple"]];
// the studio's sound effects (its Add buttons): [key, name]
const SOUNDS = [["whoosh", "Whoosh"], ["pop", "Pop"], ["boom", "Boom"], ["click", "Camera click"], ["riser", "Riser"], ["ding", "Ding"], ["swish", "Swish"], ["impact", "Impact"], ["glitch", "Glitch"], ["laser", "Laser"],
  ["heartbeat", "Heartbeat"], ["tick", "Tick"], ["chime", "Chime"], ["drop", "Bass drop"], ["rewind", "Rewind"], ["notify", "Notification"]];
const TSTYLES = [["pop", "Pop"], ["karaoke", "Karaoke"], ["box", "Box"], ["clean", "Clean"]];
const CANVAS = [["blur", "Blur"], ["color", "Colour"], ["grad", "Gradient"], ["stripes", "Stripes"], ["dots", "Dots"], ["grid", "Grid"], ["checker", "Checker"]];
const CANVAS_COLS = [["#000000", "Black"], ["#FFFFFF", "White"], ["#E85D75", "Pink"], ["#4F7CFF", "Blue"], ["#1DB954", "Green"], ["#FF9F1C", "Orange"], ["#D4B07A", "Gold"]];
/** the website's sliders for one tool: [field, name, min, max, step]; a field is a.b (an object's value) or a.b.n (one
 * point of a list, e.g. a curve); the shot's values are read from the studio, each slider sends its value when let go */
type Fine = [string, string, number, number, number?];
const CV_ID = [0, 0.25, 0.5, 0.75, 1];
const ADJUST_FINE: Fine[] = [["bri", "Brightness", -1, 1], ["con", "Contrast", -1, 1], ["sat", "Saturation", -1, 1], ["warm", "Warmth", -1, 1], ["hi", "Highlights", -1, 1], ["sh", "Shadows", -1, 1], ["hue", "Hue", -1, 1], ["sharp", "Sharpen", 0, 1], ["vig", "Vignette", 0, 1]];
const MASK_FINE: Fine[] = [["mk.x", "Across", 0, 1], ["mk.y", "Down", 0, 1], ["mk.w", "Width", 0.05, 1.5], ["mk.h", "Height", 0.05, 1.5], ["mk.a", "Turn", -180, 180, 1], ["mk.f", "Soft edge", 0, 0.3]];
const CURVE_FINE: Fine[] = ["Shadows", "Darks", "Middle", "Lights", "Highlights"].map((n, i) => [`cv.m.${i}`, n, 0, 1] as Fine);
const CROP_FINE: Fine[] = [["zoom", "Zoom", 1, 3, 0.05], ["cx", "Across", 0, 1], ["cy", "Down", 0, 1]];
function FineTune({ fields, patch }: { fields: Fine[]; patch: (v: Record<string, unknown>) => unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cs, setCs] = useState<Record<string, any> | null>(null);
  useEffect(() => { let live = true; void engine.tool("shotCs").then((c) => { if (live) setCs(c as Record<string, unknown>); }).catch(() => {}); return () => { live = false; }; }, []);
  if (!cs) return null;
  const at = (k: string) => { const [a, b, n] = k.split("."); const v = b === undefined ? cs[a] : n === undefined ? cs[a]?.[b] : (cs[a]?.[b] ?? (a === "cv" ? CV_ID : [0, 0, 0]))[+n];
    return Number(v ?? (a === "cx" || a === "cy" ? 0.5 : a === "zoom" ? 1 : a === "cv" ? CV_ID[+n] : 0)); };
  const set = (k: string, v: number) => { const [a, b, n] = k.split("."); let pt: Record<string, unknown>;
    if (b === undefined) pt = a === "cx" || a === "cy" ? { cx: a === "cx" ? v : at("cx"), cy: a === "cy" ? v : at("cy") } : { [a]: v };
    else if (n === undefined) pt = { [a]: { ...(cs[a] ?? {}), [b]: v } };
    else { const arr = [...(cs[a]?.[b] ?? (a === "cv" ? CV_ID : [0, 0, 0]))]; arr[+n] = v; pt = { [a]: { ...(cs[a] ?? {}), [b]: arr } }; }
    setCs({ ...cs, ...pt }); void patch(pt); };
  const shown = fields.filter(([k]) => !k.startsWith("mk.") || cs.mk);
  return shown.length ? <View className="gap-2 rounded-xl border border-border bg-surface-2 p-3">
    {shown.map(([k, label, min, max, step]) => <Slider key={k} label={label} value={at(k)} min={min} max={max} step={step ?? 0.01} format={(v) => k === "mk.a" ? `${Math.round(v)}°` : k === "zoom" ? `${v.toFixed(2)}×` : min < 0 ? `${v > 0 ? "+" : ""}${Math.round(v * 100)}` : `${Math.round(v * 100)}%`} onDone={(v) => set(k, v)} />)}
  </View> : null;
}
const VFX = [["none", "Original"], ["enhance", "Enhance voice"], ["deep", "Deep"], ["chipmunk", "Chipmunk"], ["robot", "Robot"], ["radio", "Radio"], ["echo", "Echo"]];
const CSNDS = [["mute", "Mute it"], ["voices", "Keep voices only"], ["all", "Keep all"]];
const BGS = [["none", "Original"], ["blur", "Blur"]];
const READY_MADE = ["Follow for more", "Save this", "Step 1", "BEFORE", "AFTER", "गणपती बाप्पा मोरया", "शुभ दीपावली", "Happy Diwali"];
const ASPECT: Record<string, number> = { "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9, "3:4": 3 / 4, "4:3": 4 / 3, "2:1": 2, "2.35:1": 2.35 };
// the tools the phone cannot do yet (they need the video engine the export uses): a line instead of a sheet
const LATER = new Set<string>();
type BulkVisualCommand = { transition?: string; effect?: boolean; unsupportedTransition?: string };
function parseBulkVisualCommand(prompt: string): BulkVisualCommand | null {
  const value = String(prompt || "").trim();
  if (!asksForAllClips(value)) return null;
  const asksTransition = /\btransitions?\b|ट्रांजिशन|ट्रांज़िशन|ट्रान्जिशन|ट्रान्झिशन|संक्रमण|转场|переход/iu.test(value);
  const asksEffect = /\b(?:effects?|effecr|fx)\b|इफेक्ट(?:्स)?|प्रभाव|效果|эффекты/iu.test(value);
  if (!asksTransition && !asksEffect) return null;
  const namedTransition: Array<[string, RegExp]> = [
    ["hard", /\bhard\s*cut\b/i], ["fadein", /\bfade\s*in\b|\bfadein\b/i],
    ["dissolve", /\bdissolve\b/i], ["crossfade", /\bcross[\s-]?fade\b/i], ["whip", /\bwhip(?:\s*pan)?\b/i], ["zoom", /\bzoom(?:\s*through)?\b/i],
    ["flash", /\bflash\b/i], ["glitch", /\bglitch\b/i], ["dip", /\bdip(?:\s*to\s*black)?\b/i],
    ["iris", /\biris\b/i], ["wipe", /\bwipe\b/i], ["spin", /\bspin\b/i],
    ["slideleft", /\b(?:slide|push)\s*left\b/i], ["slideright", /\b(?:slide|push)\s*right\b/i],
    ["bars", /\bbars?\b/i], ["diamond", /\bdiamond\b/i], ["heart", /\bheart\b/i], ["star", /\bstar\b/i],
  ];
  const matchedTransition = asksTransition ? namedTransition.find(([, pattern]) => pattern.test(value))?.[0] : undefined;
  const transition = asksTransition ? (matchedTransition ?? "fadein") : undefined;
  const unsupportedTransition = transition && !isNativeTransitionSupported(transition) ? transition : undefined;
  return { ...(unsupportedTransition ? { unsupportedTransition } : transition ? { transition } : {}), ...(asksEffect ? { effect: true } : {}) };
}

// …and Export needs the video engine, which a development or Play Store build has (Expo Go has not)

/** The editor (the website's studio editor on a phone): the Reel saved on this phone, played shot by shot with its
 * song; the timeline and the tools change it, every change is kept (undo), and it saves itself as it goes. */
export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(), words = useStudioText(), look = useColors(), locked = useLocked();
  const [p, setP] = useState<ReelProject | null>(null), [selected, setSelected] = useState(0), [playing, setPlaying] = useState(false), [local, setLocal] = useState(0);
  const [mixing, setMixing] = useState(false);
  const [exporting, setExporting] = useState<ReelProject | null>(null), [sound, setSound] = useState(true), [saved, setSaved] = useState(true), [tool, setTool] = useState<{ key: string; name: string } | null>(null), [draft, setDraft] = useState("");
  const [studioLayers, setStudioLayers] = useState<Array<{ index: number; id: number; t0: number; t1: number; x: number; y: number; scale: number; opacity: number; rotation: number; mask: string; blend: string; follow: string; followOffsetX: number; followOffsetY: number; maskWidth: number; maskHeight: number; maskThreshold: number; maskFeather: number; maskAngle: number; maskInverted: boolean; chromaKey: boolean; chromaColor: string; chromaTolerance: number }>>([]), [studioLayerIndex, setStudioLayerIndex] = useState(0);
  const [canvasCol, setCanvasCol] = useState("#4F7CFF");
  const [ttsVoices, setTtsVoices] = useState<Array<{ key: string; label: string }>>([]), [ttsVoice, setTtsVoice] = useState(""), [voiceDraft, setVoiceDraft] = useState("");
  const [captionSettings, setCaptionSettings] = useState({ enabled: false, language: "", translation: "", style: "pop" });
  const undo = useRef<ReelProject[]>([]), redo = useRef<ReelProject[]>([]), keyframeClipboard = useRef<NonNullable<ProjectClip["keyframes"]>>([]), song = useAudioPlayer(p?.audioUri ?? null);
  useEffect(() => { void getProject(id).then((x) => { if (x) setP(x); else { toast(words("This draft is no longer on this phone."), "danger"); if (router.canGoBack()) router.back(); else router.replace("/reels"); } }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tool?.key !== "voice" || !p?.studio || !engine.holds(p.id)) return;
    void engine.tool("ttsVoices").then((r) => {
      const voices = Array.isArray(r) ? r as typeof ttsVoices : [];
      setTtsVoices(voices); setTtsVoice((old) => voices.some((v) => v.key === old) ? old : voices[0]?.key ?? "");
    }).catch(() => setTtsVoices([]));
  }, [tool?.key, p?.id]);
  useEffect(() => {
    if (tool?.key !== "captions" || !p?.studio || !engine.holds(p.id)) return;
    void engine.tool("state").then((r) => {
      const settings = (r as { settings?: Record<string, unknown> }).settings ?? {};
      setCaptionSettings({ enabled: !!settings.capsOn, language: String(settings.caplang ?? ""), translation: String(settings.captr ?? ""), style: String(settings.textStyle ?? "pop") });
    }).catch(() => {});
  }, [tool?.key, p?.id]);
  useEffect(() => {
    if (!p?.studio || !engine.holds(p.id)) { setStudioLayers([]); return; }
    void engine.tool("layerList").then((r) => setStudioLayers(Array.isArray(r) ? r as typeof studioLayers : [])).catch(() => setStudioLayers([]));
  }, [tool?.key, p?.id, p?.studio]);
  // Keep the hidden Studio renderer in step with native edits and history navigation.
  // Serialize sync calls so a slow earlier edit cannot overwrite a newer timeline state.
  const studioSync = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!p?.studio || !engine.holds(p.id)) return;
    let active = true;
    const timer = setTimeout(() => {
      studioSync.current = studioSync.current
        .catch(() => undefined)
        .then(async () => {
          if (!active) return;
          await engine.edit(p);
        })
        .catch((error) => {
          if (active) console.warn("Studio edit sync deferred until export:", error);
        });
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [p]);

  // saves itself a moment after each change
  useEffect(() => {
    if (!p) return;
    setSaved(false);
    const t = setTimeout(() => void saveProject({ ...p, updatedAt: new Date().toISOString() }).then(() => setSaved(true)).catch((e) => toast(errorMessage(e), "danger")), 400);
    return () => clearTimeout(t);
  }, [p]);
  const back = useCallback(() => { setPlaying(false); router.back(); }, []);
  useEffect(() => { if (Platform.OS === "web") return; const h = BackHandler.addEventListener("hardwareBackPress", () => { if (tool) setTool(null); else back(); return true; }); return () => h.remove(); }, [tool, back]);

  const clips = p?.clips ?? [], clip = clips[selected], total = projectDuration(clips);
  const before = clips.slice(0, selected).reduce((t, c) => t + clipDuration(c), 0), now = before + local;
  // paused: the studio's own picture of this moment (what the export makes: its boxes, texts, keyframes, looks); the
  // editor's changes reach the studio first. Asked a moment after the playhead stops moving.
  const [still, setStill] = useState<string | null>(null), synced = useRef<ReelProject | null>(null);
  useEffect(() => {
    if (playing || !p || !p.studio || !engine.holds(p.id)) { setStill(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      if (synced.current !== p) { synced.current = p; await engine.edit(p).catch(() => false); }
      const src = await engine.frame(now); if (live) setStill(src);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [playing, p, now]);
  // the song plays with the Reel, from where the Reel is
  useEffect(() => { void setAudioModeAsync({ interruptionMode: "mixWithOthers", playsInSilentMode: true }).catch(() => {}); }, []); // the song and the shots play together
  useEffect(() => { if (!p?.audioUri) return; song.volume = p.settings?.musicVolume ?? 1; if (playing && sound) { song.seekTo(now + (p.settings?.start ?? 0)).catch(() => {}); song.play(); } else song.pause(); }, [playing, sound, p?.audioUri, p?.settings?.musicVolume]);
  useEffect(() => {
    if (!p?.audioUri) return;
    song.volume = evaluateAudioGain(now, {
      volume: p.settings?.musicVolume ?? 1, duration: total,
      fadeIn: p.settings?.musicFadeIn ?? 0, fadeOut: p.settings?.musicFadeOut ?? 0,
    }) * (() => {
      if (!p.settings?.musicDucking || !clip || clip.muted || clip.volume <= 0) return 1;
      const level = p.settings.musicDuckLevel ?? 0.35, localTime = Math.max(0, now - before), length = clipDuration(clip);
      const attack = 0.12, release = 0.28;
      const fadeDown = localTime < attack ? 1 - (1 - level) * localTime / attack : level;
      const fadeUp = localTime > length - release ? level + (1 - level) * (localTime - (length - release)) / release : level;
      return Math.min(1, fadeDown, fadeUp);
    })();
  }, [p?.audioUri, p?.settings?.musicVolume, p?.settings?.musicFadeIn, p?.settings?.musicFadeOut, p?.settings?.musicDucking, p?.settings?.musicDuckLevel, clip?.id, clip?.muted, clip?.volume, now, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: Partial<ReelProject>) => setP((old) => { if (!old) return old; const history = recordEdit(undo.current, old, 30); undo.current = history.undo; redo.current = history.redo; return { ...old, ...next, studio: next.studio ?? (old.studio && !("audioUri" in next) && !("overlays" in next)) }; }); // the song or the texts changed: the phone's export makes it (the clips' changes go back to the studio: engine.edit)
  const setClips = (next: ProjectClip[]) => { change({ clips: next }); setSelected((i) => Math.min(i, Math.max(0, next.length - 1))); };
  const patch = (x: Partial<ProjectClip>) => clip && setClips(clips.map((c, i) => (i === selected ? { ...c, ...x } : c)));
  const setMusicMix = async (patch: { musicVolume?: number; musicFadeIn?: number; musicFadeOut?: number; musicDucking?: boolean; musicDuckLevel?: number }) => {
    if (!p) return;
    const next = { ...p.settings, ...patch };
    change({ settings: next });
    if (p.studio && engine.holds(p.id)) {
      try {
        await engine.tool("audioMix", {
          ...(patch.musicVolume !== undefined ? { mvol: patch.musicVolume } : {}),
          ...(patch.musicFadeIn !== undefined ? { mfin: patch.musicFadeIn } : {}),
          ...(patch.musicFadeOut !== undefined ? { mfout: patch.musicFadeOut } : {}),
        });
      } catch (e) { toast(errorMessage(e), "danger"); }
    }
  };
  const studioPatch = async (value: Record<string, unknown>) => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("This advanced tool needs a Reel made by Shubix Studio."), "info");
    try { await engine.tool("seek", { time: now }); await engine.tool("shotSet", { patch: value }); toast(words("Applied to this shot"), "success"); }
    catch (e) { toast(errorMessage(e), "danger"); }
  };
  const studioStyle = async (kind: "transition" | "effect", value: string) => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("This tool needs a Reel made by Shubix Studio."), "info");
    try { await engine.tool("seek", { time: now }); await engine.tool("shotStyle", { kind, value }); }
    catch (e) { toast(errorMessage(e), "danger"); }
  };
  const copyKeyframes = () => {
    keyframeClipboard.current = clip?.keyframes?.map((frame) => ({ ...frame })) ?? [];
    toast(words(keyframeClipboard.current.length ? "Keyframes copied" : "This shot has no keyframes to copy"), keyframeClipboard.current.length ? "success" : "info");
  };
  const pasteKeyframes = () => {
    const frames = keyframeClipboard.current;
    if (!frames?.length) return toast(words("Copy keyframes from another shot first"), "info");
    if (!clip) return;
    const maxTime = clipDuration(clip);
    patch({ keyframes: frames.map((frame) => ({ ...frame, t: Math.min(maxTime, frame.t), ...(frame.bezier ? { bezier: [...frame.bezier] as [number, number, number, number] } : {}) })) });
    toast(words("Keyframes pasted to this shot"), "success");
  };
  const studioKeyframe = async (values: Record<string, number>) => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("Keyframes need a Reel made by Shubix Studio."), "info");
    try { await engine.tool("kfSeek", { time: now }); const result = await engine.tool("kfSet", { values }); if (Array.isArray(result.keyframes)) patch({ keyframes: result.keyframes as ProjectClip["keyframes"] }); toast(words("Keyframe added at the playhead"), "success"); }
    catch (e) { toast(errorMessage(e), "danger"); }
  };
  const go = (i: number) => { setSelected(Math.max(0, Math.min(clips.length - 1, i))); setLocal(0); };
  // a place on the timeline: the shot there and the time in it
  const seek = (t: number) => { let i = 0, start = 0; while (i < clips.length - 1 && start + clipDuration(clips[i]) <= t) start += clipDuration(clips[i++]); setSelected(i); setLocal(t - start); };
  // Timeline edge drags edit the source window, while keeping keyframes and speed-ramp
  // coordinates local to the newly trimmed clip.
  const trimTimelineClip = (index: number, edge: "start" | "end", deltaTimeline: number) => {
    const target = clips[index];
    if (!target || !Number.isFinite(deltaTimeline) || Math.abs(deltaTimeline) < 0.01) return;
    const sourceLength = target.end - target.start, outputLength = clipDuration(target);
    const averageRate = sourceLength / Math.max(0.001, outputLength);
    const sourceDelta = deltaTimeline * averageRate;
    let next: ProjectClip;
    if (edge === "start") {
      const nextStart = Math.min(target.end - 0.2, Math.max(0, target.start + Math.max(0, sourceDelta)));
      const removedSource = nextStart - target.start;
      if (removedSource < 0.01) return;
      const removedOutput = removedSource / averageRate;
      const ramp = target.speedRamp?.length ? [
        { time: 0, speed: evaluateSpeedRamp(target.speedRamp, removedSource, sourceLength, target.speed), easing: "linear" as const },
        ...target.speedRamp.filter((point) => point.time > removedSource + 0.001 && point.time < sourceLength).map((point) => ({ ...point, time: point.time - removedSource })),
      ] : undefined;
      next = { ...target, start: nextStart,
        ...(ramp?.length ? { speedRamp: ramp } : {}),
        ...(target.keyframes ? { keyframes: target.keyframes.filter((frame) => frame.t >= removedOutput).map((frame) => ({ ...frame, t: frame.t - removedOutput })) } : {}),
      };
    } else {
      const nextEnd = Math.max(target.start + 0.2, Math.min(target.sourceDuration, target.end + sourceDelta));
      const addedOrRemoved = nextEnd - target.end;
      if (Math.abs(addedOrRemoved) < 0.01) return;
      const nextSourceLength = nextEnd - target.start;
      const ramp = target.speedRamp?.length ? [
        ...target.speedRamp.filter((point) => point.time < nextSourceLength - 0.001),
        { time: nextSourceLength, speed: evaluateSpeedRamp(target.speedRamp, nextSourceLength, sourceLength, target.speed), easing: "linear" as const },
      ] : undefined;
      next = { ...target, end: nextEnd, ...(ramp?.length ? { speedRamp: ramp } : {}),
        ...(target.keyframes ? { keyframes: target.keyframes.filter((frame) => frame.t <= clipDuration({ ...target, end: nextEnd }) + 0.001) } : {}),
      };
    }
    const updated = clips.map((item, i) => i === index ? next : item);
    setClips(updated);
    if (index === selected) setLocal((time) => Math.min(time, Math.max(0, clipDuration(next) - 0.02)));
  };
  // Long-press a clip and drag it along the timeline to reorder the shot sequence.
  const moveTimelineClip = (index: number, deltaTimeline: number) => {
    const moving = clips[index];
    if (!moving || !Number.isFinite(deltaTimeline) || Math.abs(deltaTimeline) < 0.05) return;
    const oldStart = clips.slice(0, index).reduce((sum, item) => sum + clipDuration(item), 0);
    const dropCenter = oldStart + clipDuration(moving) / 2 + deltaTimeline;
    const remaining = clips.filter((_, i) => i !== index);
    let cursor = 0, insertAt = 0;
    for (const item of remaining) {
      if (dropCenter > cursor + clipDuration(item) / 2) insertAt++;
      cursor += clipDuration(item);
    }
    if (insertAt === index) return;
    const reordered = [...remaining.slice(0, insertAt), moving, ...remaining.slice(insertAt)];
    setClips(reordered);
    setSelected(insertAt);
    setLocal(0);
  };
  const addStudioTts = async () => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("Voice tools need a Reel made by Shubix Studio."), "info");
    if (!voiceDraft.trim() || !ttsVoice) return toast(words("Enter the words and choose a voice first."), "info");
    try {
      await engine.tool("seek", { time: now });
      await engine.tool("ttsAdd", { text: voiceDraft.trim(), voice: ttsVoice });
      setVoiceDraft(""); toast(words("Voice track added at the playhead"), "success");
    } catch (e) { toast(errorMessage(e), "danger"); }
  };
  const setStudioCaptions = async (enabled: boolean, language = captionSettings.language, translation = captionSettings.translation) => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("Caption tools need a Reel made by Shubix Studio."), "info");
    try {
      const result = await engine.tool("captions", { enabled, language, translation });
      setCaptionSettings((old) => ({ ...old, enabled, language, translation, ...(result && typeof result === "object" && "language" in result ? { language: String(result.language ?? language), translation: String(result.translation ?? translation) } : {}) }));
      toast(words(enabled ? "Captions updated" : "Captions turned off"), "success");
    } catch (e) { toast(errorMessage(e), "danger"); }
  };
  const refreshStudioLayers = async () => {
    const result = await engine.tool("layerList");
    const list = Array.isArray(result) ? result as typeof studioLayers : [];
    setStudioLayers(list); return list;
  };
  const addStudioLayer = async () => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("Overlay layers need a Reel made by Shubix Studio."), "info");
    const assets = await pickInOrder({ kind: "both", limit: 8 });
    if (!assets?.length) return;
    try {
      const files = await keepPickedAssets(`${p.id}-layer-${Date.now()}`, assets);
      for (const file of files) await engine.addLayer(file.uri, file.name);
      const list = await refreshStudioLayers(), index = Math.max(0, list.length - 1);
      setStudioLayerIndex(index); await engine.tool("layerSelect", { index });
      toast(words("Overlay layer added"), "success");
    } catch (e) { toast(errorMessage(e), "danger"); }
  };
  const studioLayerAction = async (op: string, args: Record<string, unknown> = {}) => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("Layer editing needs a Reel made by Shubix Studio."), "info");
    try {
      if (op !== "layerList" && op !== "layerAdd") await engine.tool("layerSelect", { index: studioLayerIndex });
      const result = await engine.tool(op, args);
      if (op === "layerList") setStudioLayers(Array.isArray(result) ? result as typeof studioLayers : []);
      else { await refreshStudioLayers(); if (op === "layerDelete") setStudioLayerIndex((i) => Math.max(0, i - 1)); }
    } catch (e) { toast(errorMessage(e), "danger"); }
  };
  const studioKeyframeAction = async (op: "kfEase" | "kfRemove" | "kfClear" | "kfStep", args: Record<string, unknown> = {}) => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("Keyframe controls need a Reel made by Shubix Studio."), "info");
    try {
      await engine.tool("kfSeek", { time: now });
      const result = await engine.tool(op, args);
      if (Array.isArray(result.keyframes)) patch({ keyframes: result.keyframes as ProjectClip["keyframes"] });
      else if (op === "kfClear") patch({ keyframes: undefined });
      if (op === "kfStep" && typeof result.time === "number") seek(result.time);
      if (op !== "kfStep") toast(words("Keyframe updated"), "success");
    } catch (e) { toast(errorMessage(e), "danger"); }
  };
  const ended = useCallback(() => { setLocal(0); setSelected((i) => { if (i + 1 < (p?.clips.length ?? 0)) return i + 1; setPlaying(false); return 0; }); }, [p?.clips.length]);

  async function addClips(replace = false) {
    const assets = await pickInOrder({ kind: "both", limit: replace ? 1 : 30 }); // in the order tapped
    if (!assets?.length || !p) return;
    try {
      const got = await keepPickedAssets(`${p.id}-${Date.now()}`, assets);
      setClips(replace && clip ? clips.map((c, i) => (i === selected ? { ...got[0], id: c.id } : c)) : [...clips, ...got]);
    } catch (e) { toast(errorMessage(e), "danger"); }
  }
  async function mixVideo() {
    if (!p || clips.length < 2 || mixing) return;
    if (p.studio && !engine.holds(p.id)) {
      return toast(words("Reopen this Reel from Fast Studio to create another mix without losing its advanced effects."));
    }
    setMixing(true); setPlaying(false);
    try {
      if (engine.holds(p.id)) {
        const result = await engine.remix();
        if (!result.ok) throw new Error("Studio could not create another mix. Please try again.");
        change({ clips: result.clips });
        if (result.overlays) setP((old) => old ? { ...old, overlays: result.overlays!, studio: old.studio } : old);
      } else {
        // A saved draft may be reopened after the hidden Studio session has ended.
        // Still offer an on-device alternate cut instead of hiding or disabling Mix Video.
        const reordered = clips.length > 2 ? [...clips.slice(1), clips[0]] : [...clips].reverse();
        const effectChoices = ["punch-soft", "pan-soft", "drift", "bounce", "tilt"];
        setClips(reordered.map((item, index) => ({
          ...item,
          transition: index === 0 ? "fadein" : index % 2 ? "dissolve" : "slideleft",
          effect: effectChoices[index % effectChoices.length],
        })));
      }
      setSelected(0); setLocal(0);
      toast(words("A new video mix is ready. No AI credits used."), "success");
    } catch (error) {
      toast(errorMessage(error), "danger");
    } finally {
      setMixing(false);
    }
  }

  async function chooseSong() {
    if (!p) return;
    try { const s = await pickSong(); if (s) { const uri = await keepPickedFile(p.id, s.uri, `${s.name}.m4a`); if (p.studio && engine.holds(p.id)) await engine.song(uri, s.name); change({ audioUri: uri, audioName: s.name }); } } catch (e) { toast(errorMessage(e), "danger"); }
  }
  async function removeShot() {
    if (clips.length === 1) return toast(words("A Reel needs at least one shot."), "info");
    if (await confirmAction({ title: words("Delete this shot?"), ok: words("Delete"), danger: true })) setClips(clips.filter((_, i) => i !== selected));
  }
  // the text being edited (the Text panel): its settings change as on the website's text editor
  const [txSel, setTxSel] = useState(""), txt = p?.overlays.find((o) => o.id === txSel);
  const setTx = (patch: Partial<Overlay>) => p && txt && change({ overlays: p.overlays.map((o) => (o.id === txt.id ? { ...o, ...patch } : o)) });
  const addText = (text: string) => {
    if (!text.trim() || !p) return;
    if (now >= total - 0.05) return toast(words("Move the playhead before the end of the Reel to add text."), "info");
    const start = Math.max(0, now), end = Math.min(total, start + 3);
    if (end - start < 0.1) return toast(words("There is not enough time left in this Reel for a text overlay."), "info");
    change({ overlays: [...p.overlays, { id: `t-${Date.now()}`, text: text.trim(), start, end, color: "#FFFFFF", size: 36 } as Overlay] });
    setDraft("");
  };

  /** a tool from the row, or a clip tool: what it changes straight away, else its sheet */
  /** a choice in a tool as the website makes it: in the studio when it holds this Reel (`box`/`attr`: its button, or
   * its input `box`), else on the phone (`here`: what the phone does with it) */
  async function choose(key: keyof NonNullable<ReelProject["settings"]>, value: string | boolean, box: string, attr?: string, here?: () => Partial<ReelProject>) {
    if (!p) return;
    const settings = { ...p.settings, [key]: value };
    try {
      const next = p.studio ? await engine.set(p, box, value, attr) : null;
      if (next) return change({ clips: next, settings });
    } catch (e) { return toast(errorMessage(e), "danger"); }
    change({ ...here?.(), settings, studio: false });
  }
  const Seg = ({ k, items, box, attr, here }: { k: "mode" | "look" | "tstyle" | "csnd" | "bg"; items: string[][]; box: string; attr: string; here?: (v: string) => Partial<ReelProject> }) =>
    <Segmented small value={String(p?.settings?.[k] ?? items[0][0])} onChange={(v) => void choose(k, v, box, attr, here && (() => here(v)))} options={items.map(([value, label]) => ({ value, label: words(label) }))} />;
  const Label = ({ children }: { children: string }) => <Text className="text-[11px] font-bold uppercase tracking-[1px] text-muted">{words(children)}</Text>;
  const touch = p?.settings?.touch ?? true;

  function use(key: string, name: string) {
    const lock = locked?.(key);
    if (lock) return toast(words("This isn't in your current plan."), "info");
    if (LATER.has(key)) return toast(words("{tool} comes with the phone's video engine, in the Play Store app.", { tool: words(name) }), "info");
    if (!clip) return;
    const s = clip.end - clip.start;
    switch (key) {
      case "split": { const r = splitClip(clip, `${clip.id}-${Date.now()}`); if (!r) return toast(words("Keep at least a small moment on each side of the split."), "info"); setClips(clips.flatMap((c, i) => (i === selected ? r : [c]))); return; }
      case "dup": setClips([...clips.slice(0, selected + 1), { ...clip, id: `${clip.id}-${Date.now()}` }, ...clips.slice(selected + 1)]); return go(selected + 1);
      case "freeze": return patch({ speed: 0.25 });
      case "other": case "slip": {
        const slipped = slipClip({
          id: clip.id, start: 0, duration: s, sourceStart: clip.start, sourceEnd: clip.end,
        }, 1, clip.sourceDuration);
        const nextStart = slipped.sourceStart ?? clip.start;
        if (Math.abs(nextStart - clip.start) < 0.001) return toast(words("This clip has no other moment."), "info");
        return patch({ start: nextStart, end: slipped.sourceEnd ?? nextStart + s });
      }
      case "rev": return patch({ reverse: !clip.reverse });
      case "rot": return patch({ rotation: (clip.rotation + 90) % 360 });
      case "fh": return patch({ mirror: !clip.mirror });
      case "fv": return patch({ flip: !clip.flip });
      case "fit": return patch({ fit: clip.fit === "cover" ? "contain" : "cover" });
      case "reset": return patch({ speed: 1, reverse: false, muted: false, volume: 1, filter: "Original", transition: "Cut", rotation: 0, mirror: false, flip: false, fit: "cover", start: 0, end: clip.sourceDuration });
      case "delete": void removeShot(); return;
    }
    setTool({ key, name });
  }

  function sheet() {
    if (!tool || !p) return null;
    switch (tool.key) {
      case "media": return <View className="gap-2"><Button full icon="plus" title={words("Add clips")} onPress={() => void addClips()} /><Button full variant="secondary" icon="refresh" title={words("Replace this shot")} onPress={() => void addClips(true)} /><Button full variant="danger" icon="trash" title={words("Delete this shot")} onPress={() => void removeShot()} /></View>;
      case "stickers": return <Choices items={STICKERS} onPick={addText} />;
      case "look": return (
        <View className="gap-3">
          <Pressable onPress={() => void choose("touch", !touch, "aitouch")} accessibilityRole="checkbox" accessibilityState={{ checked: touch }} className="flex-row gap-2.5">
            <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${touch ? "border-accent bg-accent" : "border-border"}`}>{touch && <Text className="text-[12px] font-bold text-background">✓</Text>}</View>
            <Text className="flex-1 text-[12.5px] leading-[18px] text-foreground">{words("Shubix touch-ups: fit wide clips, fix dark shots, keep voices, one reversed drop, fade out at the end")}</Text>
          </Pressable>
          <Seg k="look" items={LOOKS} box="look" attr="data-l" here={(v) => ({ clips: clips.map((c) => ({ ...c, filter: LOOKS.find((l) => l[0] === v)![2] })) })} />
          <Label>Filter on this shot</Label>
          <Choices items={FILTERS} on={clip?.filter} onPick={(filter) => patch({ filter })} />
        </View>
      );
      case "style": return <View className="gap-3"><Seg k="mode" items={MODES} box="mode" attr="data-m" here={(v) => ({ clips: clips.map((c) => ({ ...c, speed: v === "fast" ? 1.25 : v === "smooth" ? 0.8 : 1 })) })} /><Text className="text-[12.5px] leading-[18px] text-muted">{words(MODE_HELP[p.settings?.mode ?? "auto"])}</Text></View>;
      case "shots": return <><Choices items={clips.map((_, i) => `${words("Shot")} ${i + 1}`)} on={`${words("Shot")} ${selected + 1}`} onPick={(v) => go(Number(v.split(" ").pop()) - 1)} /><Button full variant="secondary" icon="plus" title={words("Add shot")} onPress={() => void addClips()} /></>;
      case "music": return (
        <View className="gap-2">
          <Text className="text-[13px] text-foreground">{p.audioName ?? words("No song yet")}</Text>
          <Button full icon="music" title={words(p.audioUri ? "Change the song or its part" : "Choose song")} onPress={() => void chooseSong()} />
          <Button full variant="secondary" icon="plus" title={words("Add or change clips")} onPress={() => void addClips()} />
          <View className="gap-2 rounded-xl border border-border bg-surface-2 p-3">
            <Label>Music track volume</Label>
            <Choices items={["0%", "25%", "50%", "75%", "100%"]} on={`${Math.round((p.settings?.musicVolume ?? 1) * 100)}%`} onPick={(v) => void setMusicMix({ musicVolume: Number(v.replace("%", "")) / 100 })} />
            <Text className="text-[11px] text-muted">{words("Music volume is applied to both playback and MP4 export.")}</Text>
            <Label>Music fade in</Label>
            <Choices items={["Off", "0.5s", "1s", "2s", "3s"]} on={String(p.settings?.musicFadeIn ?? 0) === "0" ? "Off" : String(p.settings?.musicFadeIn) + "s"} onPick={(v) => void setMusicMix({ musicFadeIn: v === "Off" ? 0 : Number(v.replace("s", "")) })} />
            <Label>Music fade out</Label>
            <Choices items={["Off", "0.5s", "1s", "2s", "3s"]} on={String(p.settings?.musicFadeOut ?? (p.studio ? 0.8 : 0)) === "0" ? "Off" : String(p.settings?.musicFadeOut ?? (p.studio ? 0.8 : 0)) + "s"} onPick={(v) => void setMusicMix({ musicFadeOut: v === "Off" ? 0 : Number(v.replace("s", "")) })} />
            {!p.studio && <>
              <Label>Auto duck music under clip audio</Label>
              <Choices items={["Off", "Light", "Strong"]} on={!p.settings?.musicDucking ? "Off" : (p.settings?.musicDuckLevel ?? 0.35) >= 0.5 ? "Light" : "Strong"} onPick={(v) => void setMusicMix({ musicDucking: v !== "Off", musicDuckLevel: v === "Light" ? 0.6 : 0.28 })} />
              <Text className="text-[11px] text-muted">{words("Lowers the song while original clip audio is audible, then smoothly restores it.")}</Text>
            </>}
          </View>
          <View className="mt-1 gap-1.5 rounded-xl border border-border bg-surface-2 p-3">
            <Text className="text-[13px] font-semibold text-foreground">{words("Your clips have their own sound")}</Text>
            <Text className="text-[12px] leading-[17px] text-muted">{words("Wind, traffic, people talking… Choose what the Reel keeps under the song.")}</Text>
            <Seg k="csnd" items={CSNDS} box="csnd" attr="data-c" here={(v) => ({ clips: clips.map((c) => ({ ...c, muted: v === "mute" })) })} />
          </View>
          {p.studio && <View className="gap-2 rounded-xl border border-border bg-surface-2 p-3">
            <Label>Sound effects (at the playhead)</Label>
            <Choices items={SOUNDS.map((s) => s[1])} onPick={(v) => void (async () => {
              if (!engine.holds(p.id)) return toast(words("This tool needs a Reel made by Shubix Studio."), "info");
              const kind = SOUNDS.find((s) => s[1] === v)![0];
              try { await engine.edit(p); const r = await engine.tool("sfx", { kind, time: now }) as { ok?: boolean }; toast(words(r?.ok ? "Sound added" : "This sound is not available"), r?.ok ? "success" : "info"); }
              catch (e) { toast(errorMessage(e), "danger"); }
            })()} />
          </View>}
          {p.studio && <View className="gap-2 rounded-xl border border-border bg-surface-2 p-3">
            <Label>Your beat markers (a cut can land on each)</Label>
            <Choices items={["Add marker here", "Remove marker here", "Remove all markers"]} onPick={(v) => void (async () => {
              if (!engine.holds(p.id)) return toast(words("This tool needs a Reel made by Shubix Studio."), "info");
              try { const next = await engine.mark(p, v.startsWith("Add") ? "add" : v.startsWith("Remove marker") ? "del" : "clear", now);
                if (next) { setP((old) => old ? { ...old, clips: next } : old); toast(words("Done: the cuts follow your markers"), "success"); } else toast(words("Nothing changed"), "info"); }
              catch (e) { toast(errorMessage(e), "danger"); }
            })()} />
            <Label>Voice effect (on your recorded voiceover)</Label>
            <Choices items={VFX.map((x) => x[1])} onPick={(v) => void (async () => {
              if (!engine.holds(p.id)) return toast(words("This tool needs a Reel made by Shubix Studio."), "info");
              try { await engine.set(p, "vfx", VFX.find((x) => x[1] === v)![0], "data-f"); toast(words("Voice effect applied"), "success"); } catch (e) { toast(errorMessage(e), "danger"); }
            })()} />
          </View>}
          {p.audioUri && <Button full variant="danger" icon="trash" title={words("Remove music")} onPress={() => change({ audioUri: undefined, audioName: undefined })} />}
          {clip && <>
            <Label>Selected shot audio volume</Label>
            <Choices items={["0%", "25%", "50%", "75%", "100%", "125%", "150%", "200%"]} on={`${Math.round((clip.volume ?? 1) * 100)}%`} onPick={(v) => patch({ volume: Number(v.replace("%", "")) / 100, muted: v === "0%" })} />
            <Button full variant="secondary" title={words(clip.muted ? "Turn the clip's sound on" : "Mute the clip's sound")} onPress={() => patch({ muted: !clip.muted })} />
            {p.studio && <Button full variant="secondary" title={words("Enhance this shot's voice")} onPress={() => void studioPatch({ enh: true })} />}
          </>}
        </View>
      );
      case "text": return (
        <View className="gap-2">
          <Label>Hook text (3-5 words, first 2 seconds)</Label>
          <TextInput defaultValue={p.settings?.hook ?? ""} onEndEditing={(e) => void choose("hook", e.nativeEvent.text.trim(), "hook")} placeholder={words("e.g. WAIT FOR THE DROP")} placeholderTextColor={look.muted} maxLength={40} className="h-12 rounded-xl border border-border bg-surface-2 px-4 text-[14px] text-foreground" />
          <Label>Text style</Label>
          <Seg k="tstyle" items={TSTYLES} box="tstyle" attr="data-t" />
          <Label>Text & stickers</Label>
          <TextInput value={draft} onChangeText={setDraft} placeholder={words("Type your text")} placeholderTextColor={look.muted} maxLength={80} className="h-12 rounded-xl border border-border bg-surface-2 px-4 text-[14px] text-foreground" />
          <View className="flex-row gap-2"><Button className="flex-1" icon="plus" disabled={!draft.trim()} title={words("Text")} onPress={() => addText(draft)} /><Button className="flex-1" variant="secondary" icon="plus" title={words("Sticker")} onPress={() => setTool({ key: "stickers", name: "Stickers" })} /></View>
          <Choices items={READY_MADE} onPick={addText} />
          {p.studio && <>
            <Label>Text templates (at the playhead)</Label>
            <Choices items={Object.values(TEXT_TEMPLATES).map((t) => t.name)} onPick={(v) => void (async () => {
              if (!engine.holds(p.id)) return toast(words("This tool needs a Reel made by Shubix Studio."), "info");
              const key = Object.keys(TEXT_TEMPLATES).find((k) => TEXT_TEMPLATES[k].name === v)!;
              try { await engine.edit(p); const r = await engine.tool("template", { key, time: now }) as { ok?: boolean; state?: { overlays?: unknown } }; const list = textsOf(r?.state?.overlays);
                if (r?.ok && list) setP((old) => old ? { ...old, overlays: list } : old); toast(words(r?.ok ? "Template added: tap a text to change its words" : "This template is not available"), r?.ok ? "success" : "info"); }
              catch (e) { toast(errorMessage(e), "danger"); }
            })()} />
          </>}
          {p.overlays.map((o) => <Pressable key={o.id} onPress={() => setTxSel(txSel === o.id ? "" : o.id)} className={`flex-row items-center gap-2 rounded-xl border px-3 py-2 ${txSel === o.id ? "border-accent" : "border-border"}`}><Text numberOfLines={1} className="flex-1 text-[13px] text-foreground">{o.text}</Text><IconButton icon="trash" look="danger" size={32} label={words("Delete")} onPress={() => change({ overlays: p.overlays.filter((x) => x.id !== o.id) })} /></Pressable>)}
          {/* the tapped text: its look and motion, as the website's text editor (drawn by the studio in the paused preview and the export) */}
          {txt && <View className="gap-2 rounded-xl border border-border bg-surface-2 p-3">
            <Label>Style</Label><Choices items={TX_STYLES.map((s) => s[1])} on={TX_STYLES.find((s) => s[0] === (txt.style ?? "bold"))?.[1]} onPick={(v) => setTx({ style: TX_STYLES.find((s) => s[1] === v)![0] })} />
            <Label>Entrance</Label><Choices items={TX_INS.map((s) => s[1])} on={TX_INS.find((s) => s[0] === (txt.anim ?? "pop"))?.[1]} onPick={(v) => setTx({ anim: TX_INS.find((s) => s[1] === v)![0] })} />
            <Label>Exit</Label><Choices items={TX_OUTS.map((s) => s[1])} on={TX_OUTS.find((s) => s[0] === (txt.out ?? "none"))?.[1]} onPick={(v) => setTx({ out: TX_OUTS.find((s) => s[1] === v)![0] })} />
            <Label>Keeps moving</Label><Choices items={TX_LOOPS.map((s) => s[1])} on={TX_LOOPS.find((s) => s[0] === (txt.loop ?? "none"))?.[1]} onPick={(v) => setTx({ loop: TX_LOOPS.find((s) => s[1] === v)![0] })} />
            <Label>Colour</Label><Choices items={TX_COLORS.map((s) => s[1])} on={TX_COLORS.find((s) => s[0] === txt.color)?.[1]} onPick={(v) => setTx({ color: TX_COLORS.find((s) => s[1] === v)![0] })} />
            <Label>Size</Label><Choices items={["Small", "Medium", "Large", "Huge"]} on={txt.size <= 26 ? "Small" : txt.size <= 40 ? "Medium" : txt.size <= 60 ? "Large" : "Huge"} onPick={(v) => setTx({ size: ({ Small: 24, Medium: 36, Large: 54, Huge: 80 } as Record<string, number>)[v] })} />
          </View>}
        </View>
      );
      case "bg": return <Seg k="bg" items={BGS} box="bgmode" attr="data-b" />;
      case "captions": return <View className="gap-2">
        <Label>Automatic captions</Label>
        <Choices items={["Off", "On"]} on={captionSettings.enabled ? "On" : "Off"} onPick={(v) => void setStudioCaptions(v === "On")} />
        <Label>Spoken language</Label>
        <Choices items={["Detect automatically", "Hindi", "Marathi", "English", "Gujarati", "Punjabi", "Bengali", "Tamil", "Telugu"]} on={captionSettings.language ? ({ hi: "Hindi", mr: "Marathi", en: "English", gu: "Gujarati", pa: "Punjabi", bn: "Bengali", ta: "Tamil", te: "Telugu" } as Record<string, string>)[captionSettings.language] : "Detect automatically"} onPick={(v) => {
          const language = ({ "Detect automatically": "", Hindi: "hi", Marathi: "mr", English: "en", Gujarati: "gu", Punjabi: "pa", Bengali: "bn", Tamil: "ta", Telugu: "te" } as Record<string, string>)[v];
          void setStudioCaptions(captionSettings.enabled, language, captionSettings.translation);
        }} />
        <Label>Translation</Label>
        <Choices items={["Off", "Hindi", "Marathi", "English", "Hinglish"]} on={captionSettings.translation ? ({ hi: "Hindi", mr: "Marathi", en: "English", hinglish: "Hinglish" } as Record<string, string>)[captionSettings.translation] : "Off"} onPick={(v) => {
          const translation = ({ Off: "", Hindi: "hi", Marathi: "mr", English: "en", Hinglish: "hinglish" } as Record<string, string>)[v];
          void setStudioCaptions(captionSettings.enabled, captionSettings.language, translation);
        }} />
        <Label>Caption animation</Label>
        <Choices items={["Pop", "Karaoke", "Box", "Clean"]} on={({ pop: "Pop", karaoke: "Karaoke", box: "Box", clean: "Clean" } as Record<string, string>)[captionSettings.style] ?? "Pop"} onPick={(v) => {
          const style = ({ Pop: "pop", Karaoke: "karaoke", Box: "box", Clean: "clean" } as Record<string, string>)[v];
          setCaptionSettings((old) => ({ ...old, style })); void engine.tool("captionStyle", { style }).catch((e) => toast(errorMessage(e), "danger"));
        }} />
      </View>;
      case "voice": return <View className="gap-2">
        <Label>Text to speech voiceover</Label>
        <TextInput value={voiceDraft} onChangeText={setVoiceDraft} multiline placeholder={words("Write the voiceover script…")} placeholderTextColor={look.muted} className="min-h-[96px] rounded-xl border border-border bg-surface px-3 py-2 text-foreground" />
        <Choices items={ttsVoices.map((v) => v.label)} on={ttsVoices.find((v) => v.key === ttsVoice)?.label} onPick={(label) => setTtsVoice(ttsVoices.find((v) => v.label === label)?.key ?? "")} />
        <Button full icon="music" title={words("Add voice at playhead")} disabled={!voiceDraft.trim() || !ttsVoice} onPress={() => void addStudioTts()} />
        <Button full variant="danger" title={words("Remove generated speech")} onPress={() => void engine.tool("ttsClear").then(() => toast(words("Generated speech removed"), "success")).catch((e) => toast(errorMessage(e), "danger"))} />
        <Text className="text-[11px] text-muted">{words("Generated voice is mixed into the Studio export and saved with this Reel.")}</Text>
      </View>;
      case "layers": return <View className="gap-2">
        <Button full icon="image" title={words("Add photo / video layer")} onPress={() => void addStudioLayer()} />
        <Text className="text-[11px] leading-[16px] text-muted">{words("Layers are composited by the Studio renderer for export. The Android preview currently shows the base shot and text overlays; complex layer blends and masks are visible in the final Studio render.")}</Text>
        {studioLayers.length > 0 && <>
          <Label>Overlay layers</Label>
          <Choices items={studioLayers.map((layer) => `Layer ${layer.index + 1}`)} on={`Layer ${studioLayerIndex + 1}`} onPick={(v) => {
            const index = Math.max(0, Number(v.replace("Layer ", "")) - 1); setStudioLayerIndex(index);
            void engine.tool("layerSelect", { index }).catch((e) => toast(errorMessage(e), "danger"));
          }} />
          <Label>Position and transform</Label>
          <Choices items={["Move left", "Move right", "Move up", "Move down", "Scale up", "Scale down", "Rotate left", "Rotate right", "Opacity 50%", "Opacity 100%"]} onPick={(v) => {
            const layer = studioLayers.find((x) => x.index === studioLayerIndex);
            const values: Record<string, [string, number]> = {
              "Move left": ["x", Math.max(0, (layer?.x ?? 0.5) - 0.05)], "Move right": ["x", Math.min(1, (layer?.x ?? 0.5) + 0.05)],
              "Move up": ["y", Math.max(0, (layer?.y ?? 0.5) - 0.05)], "Move down": ["y", Math.min(1, (layer?.y ?? 0.5) + 0.05)],
              "Scale up": ["s", Math.min(1.5, (layer?.scale ?? 0.5) + 0.05)], "Scale down": ["s", Math.max(0.05, (layer?.scale ?? 0.5) - 0.05)],
              "Rotate left": ["r", (layer?.rotation ?? 0) - 5], "Rotate right": ["r", (layer?.rotation ?? 0) + 5],
              "Opacity 50%": ["op", 0.5], "Opacity 100%": ["op", 1],
            };
            const [key, value] = values[v]; void studioLayerAction("layerSet", { key, value });
          }} />
          <Label>Mask and blend</Label>
          <Choices items={["No mask", "Circle mask", "Radial mask", "Rectangle mask", "Polygon mask", "Linear mask", "Mirror mask", "Luma mask"]} on={({ none: "No mask", circle: "Circle mask", radial: "Radial mask", rect: "Rectangle mask", polygon: "Polygon mask", line: "Linear mask", mirror: "Mirror mask", luma: "Luma mask" } as Record<string, string>)[studioLayers.find((x) => x.index === studioLayerIndex)?.mask ?? "none"] ?? "No mask"} onPick={(v) => {
            const mask = ({ "No mask": "none", "Circle mask": "circle", "Radial mask": "radial", "Rectangle mask": "rect", "Polygon mask": "polygon", "Linear mask": "line", "Mirror mask": "mirror", "Luma mask": "luma" } as Record<string, string>)[v];
            void (async () => { await studioLayerAction("layerSet", { key: "mask", value: mask }); if (mask === "luma") { await studioLayerAction("layerSet", { key: "mk.th", value: 0.5 }); await studioLayerAction("layerSet", { key: "mk.f", value: 0.12 }); } })();
          }} />
          <Label>Mask refinement</Label>
          <Choices items={["Mask smaller", "Mask larger", "More feather", "Less feather", "Rotate mask", "Invert mask", "Reset mask"]} onPick={(v) => {
            const layer = studioLayers.find((x) => x.index === studioLayerIndex);
            if (v === "Mask smaller") void studioLayerAction("layerSet", { key: "mk.w", value: Math.max(0.1, (layer?.maskWidth ?? 0.8) - 0.1) });
            else if (v === "Mask larger") void studioLayerAction("layerSet", { key: "mk.w", value: Math.min(1, (layer?.maskWidth ?? 0.8) + 0.1) });
            else if (v === "More feather") void studioLayerAction("layerSet", { key: "mk.f", value: Math.min(0.5, (layer?.maskFeather ?? 0.12) + 0.05) });
            else if (v === "Less feather") void studioLayerAction("layerSet", { key: "mk.f", value: Math.max(0, (layer?.maskFeather ?? 0.12) - 0.05) });
            else if (v === "Rotate mask") void studioLayerAction("layerSet", { key: "mk.a", value: (layer?.maskAngle ?? 0) + 15 });
            else if (v === "Invert mask") void studioLayerAction("layerSet", { key: "mk.inv", value: !layer?.maskInverted });
            else void (async () => { await studioLayerAction("layerSet", { key: "mk.w", value: 0.8 }); await studioLayerAction("layerSet", { key: "mk.h", value: 0.8 }); await studioLayerAction("layerSet", { key: "mk.th", value: 0.5 }); await studioLayerAction("layerSet", { key: "mk.f", value: 0.12 }); await studioLayerAction("layerSet", { key: "mk.a", value: 0 }); await studioLayerAction("layerSet", { key: "mk.inv", value: false }); })();
          }} />
          {studioLayers.find((x) => x.index === studioLayerIndex)?.mask === "luma" && <>
            <Label>Luma threshold</Label>
            <Choices items={["Reveal brighter areas", "Reveal darker areas", "Increase threshold", "Decrease threshold"]} onPick={(v) => {
              const layer = studioLayers.find((x) => x.index === studioLayerIndex);
              if (v === "Reveal brighter areas") void studioLayerAction("layerSet", { key: "mk.inv", value: false });
              else if (v === "Reveal darker areas") void studioLayerAction("layerSet", { key: "mk.inv", value: true });
              else if (v === "Increase threshold") void studioLayerAction("layerSet", { key: "mk.th", value: Math.min(0.95, (layer?.maskThreshold ?? 0.5) + 0.05) });
              else void studioLayerAction("layerSet", { key: "mk.th", value: Math.max(0.05, (layer?.maskThreshold ?? 0.5) - 0.05) });
            }} />
          </>}
          <Label>Chroma key</Label>
          <Choices items={["Off", "Green screen", "Blue screen"]} on={studioLayers.find((x) => x.index === studioLayerIndex)?.chromaKey ? (studioLayers.find((x) => x.index === studioLayerIndex)?.chromaColor === "#0000FF" ? "Blue screen" : "Green screen") : "Off"} onPick={(v) => {
            if (v === "Off") void studioLayerAction("layerSet", { key: "key", value: { on: false, c: "#00FF00", tol: 0.35 } });
            else void studioLayerAction("layerSet", { key: "key", value: { on: true, c: v === "Blue screen" ? "#0000FF" : "#00FF00", tol: 0.35 } });
          }} />
          <Choices items={["Normal", "Multiply", "Screen", "Overlay", "Soft light", "Hard light", "Color dodge", "Color burn", "Difference", "Exclusion", "Hue", "Saturation", "Color", "Luminosity"]} on={({ "source-over": "Normal", multiply: "Multiply", screen: "Screen", overlay: "Overlay", "soft-light": "Soft light", "hard-light": "Hard light", "color-dodge": "Color dodge", "color-burn": "Color burn", difference: "Difference", exclusion: "Exclusion", hue: "Hue", saturation: "Saturation", color: "Color", luminosity: "Luminosity" } as Record<string, string>)[studioLayers.find((x) => x.index === studioLayerIndex)?.blend ?? "source-over"] ?? "Normal"} onPick={(v) => {
            const blend = ({ Normal: "source-over", Multiply: "multiply", Screen: "screen", Overlay: "overlay", "Soft light": "soft-light", "Hard light": "hard-light", "Color dodge": "color-dodge", "Color burn": "color-burn", Difference: "difference", Exclusion: "exclusion", Hue: "hue", Saturation: "saturation", Color: "color", Luminosity: "luminosity" } as Record<string, string>)[v];
            void studioLayerAction("layerSet", { key: "blend", value: blend });
          }} />
          <Label>Face tracking</Label>
          <Choices items={["Off", "Follow face", "Nudge left", "Nudge right", "Nudge up", "Nudge down"]} on={studioLayers.find((x) => x.index === studioLayerIndex)?.follow === "face" ? "Follow face" : "Off"} onPick={(v) => {
            const layer = studioLayers.find((x) => x.index === studioLayerIndex);
            if (v === "Off") void studioLayerAction("layerSet", { key: "follow", value: "none" });
            else if (v === "Follow face") void (async () => { await studioLayerAction("layerSet", { key: "follow", value: "face" }); await studioLayerAction("layerSet", { key: "followOffsetX", value: 0 }); await studioLayerAction("layerSet", { key: "followOffsetY", value: -0.12 }); })();
            else if (v === "Nudge left") void studioLayerAction("layerSet", { key: "followOffsetX", value: (layer?.followOffsetX ?? 0) - 0.03 });
            else if (v === "Nudge right") void studioLayerAction("layerSet", { key: "followOffsetX", value: (layer?.followOffsetX ?? 0) + 0.03 });
            else if (v === "Nudge up") void studioLayerAction("layerSet", { key: "followOffsetY", value: (layer?.followOffsetY ?? -0.12) - 0.03 });
            else void studioLayerAction("layerSet", { key: "followOffsetY", value: (layer?.followOffsetY ?? -0.12) + 0.03 });
          }} />
          <Text className="text-[11px] text-muted">{words("Follows the detected face in the base shot. Tracking uses available face-analysis frames.")}</Text>
          <Label>Layer fade and audio</Label>
          <Choices items={["Fade in 0.5s", "Fade out 0.5s", "No fade", "Mute layer audio", "Layer audio 50%", "Layer audio 100%"]} onPick={(v) => {
            if (v === "Fade in 0.5s") void studioLayerAction("layerSet", { key: "fin", value: 0.5 });
            else if (v === "Fade out 0.5s") void studioLayerAction("layerSet", { key: "fout", value: 0.5 });
            else if (v === "No fade") void (async () => { await studioLayerAction("layerSet", { key: "fin", value: 0 }); await studioLayerAction("layerSet", { key: "fout", value: 0 }); })();
            else if (v === "Mute layer audio") void studioLayerAction("layerSet", { key: "vol", value: 0 });
            else void studioLayerAction("layerSet", { key: "vol", value: v === "Layer audio 50%" ? 0.5 : 1 });
          }} />
          <Label>Layer timing</Label>
          <Choices items={["Start at playhead", "End at playhead", "Show entire Reel"]} onPick={(v) => {
            const layer = studioLayers.find((x) => x.index === studioLayerIndex);
            if (v === "Start at playhead") void studioLayerAction("layerSet", { key: "t0", value: now });
            else if (v === "End at playhead") void studioLayerAction("layerSet", { key: "t1", value: Math.max(now, (layer?.t0 ?? 0) + 0.3) });
            else void (async () => { await studioLayerAction("layerSet", { key: "t0", value: 0 }); await studioLayerAction("layerSet", { key: "t1", value: total }); })();
          }} />
          <Button full variant="danger" title={words("Delete selected layer")} onPress={() => void studioLayerAction("layerDelete")} />
        </>}
      </View>;
      case "canvas": return <View className="gap-2">
        <Choices items={["Fill", "Fit"]} on={clip?.fit === "contain" ? "Fit" : "Fill"} onPick={(v) => patch({ fit: v === "Fit" ? "contain" : "cover" })} />
        {p.studio && <><Label>Behind a fitted picture</Label>
          <Choices items={CANVAS.map((c) => c[1])} onPick={(v) => { const k = CANVAS.find((c) => c[1] === v)![0]; void studioPatch({ fit: true, bg: k === "blur" ? "blur" : k, ...(k === "blur" ? {} : { bgc: canvasCol }) }); }} />
          <Choices items={CANVAS_COLS.map((c) => c[1])} on={CANVAS_COLS.find((c) => c[0] === canvasCol)?.[1]} onPick={(v) => setCanvasCol(CANVAS_COLS.find((c) => c[1] === v)![0])} /></>}
      </View>;
      case "crop": return <View className="gap-2"><Choices items={["Fill", "Fit"]} on={clip?.fit === "contain" ? "Fit" : "Fill"} onPick={(v) => patch({ fit: v === "Fit" ? "contain" : "cover" })} />{p.studio && <FineTune key={`z${selected}`} fields={CROP_FINE} patch={studioPatch} />}</View>;
      case "sp": return <View className="gap-2">
        <Label>Playback speed</Label>
        <Choices items={SPEEDS} on={`${clip?.speed}×`} onPick={(v) => patch({ speed: parseFloat(v), speedRamp: undefined })} />
        <Label>Speed ramp presets</Label>
        <Choices items={["Normal", "Montage", "Hero slow motion", "Speed up", "Action punch"]} onPick={(v) => {
          if (!clip) return;
          const duration = Math.max(0.1, clip.end - clip.start);
          const curves: Record<string, NonNullable<ProjectClip["speedRamp"]>> = {
            Normal: [],
            Montage: [{ time: 0, speed: 1 }, { time: duration * 0.25, speed: 2.2, easing: "outCubic" }, { time: duration * 0.7, speed: 2.2, easing: "inOut" }, { time: duration, speed: 1 }],
            "Hero slow motion": [{ time: 0, speed: 1 }, { time: duration * 0.3, speed: 0.35, easing: "outCubic" }, { time: duration * 0.75, speed: 0.35, easing: "hold" }, { time: duration, speed: 1.4, easing: "inOut" }],
            "Speed up": [{ time: 0, speed: 0.6, easing: "in" }, { time: duration * 0.5, speed: 1.4, easing: "inOut" }, { time: duration, speed: 2.5, easing: "out" }],
            "Action punch": [{ time: 0, speed: 1 }, { time: duration * 0.35, speed: 0.45, easing: "outCubic" }, { time: duration * 0.55, speed: 0.45, easing: "hold" }, { time: duration, speed: 2.4, easing: "inOut" }],
          };
          patch({ speed: 1, speedRamp: curves[v].length ? curves[v] : undefined });
          toast(words(v === "Normal" ? "Speed ramp cleared" : `${v} curve saved to this clip`), "success");
        }} />
        <Text className="text-[11px] text-muted">{words(clip?.speedRamp?.length ? `${clip.speedRamp.length} curve points saved. The mobile preview and native export use this variable-speed curve.` : "Choose a speed curve preset. The curve is stored with this clip.")}</Text>
      </View>;
      case "motion": return <View className="gap-2">
        <Text className="text-[11px] text-muted">{words("Move the playhead, then add a keyframe. Add another at a later time to animate the move.")}</Text>
        <Choices items={["Zoom in", "Zoom out", "Slide left", "Slide right", "Move up", "Move down", "Rotate", "Fade", "Reset frame"]} onPick={(v) => {
          const values: Record<string, Record<string, number>> = {
            "Zoom in": { s: 1.2 }, "Zoom out": { s: 0.85 }, "Slide left": { x: -0.08 }, "Slide right": { x: 0.08 },
            "Move up": { y: -0.08 }, "Move down": { y: 0.08 }, Rotate: { r: 8 }, Fade: { o: 0.45 },
            "Reset frame": { x: 0, y: 0, s: 1, r: 0, o: 1 },
          }; void studioKeyframe(values[v]);
        }} />
        <Label>Keyframe easing</Label>
        <Choices items={["Smooth", "Linear", "Ease in", "Ease out", "Overshoot", "Fast stop", "Bezier", "Hold"]} onPick={(v) => {
          const easing: Record<string, string> = { Smooth: "inOut", Linear: "lin", "Ease in": "inQuad", "Ease out": "outCubic", Overshoot: "outBack", "Fast stop": "outExpo", Bezier: "bezier", Hold: "hold" };
          void studioKeyframeAction("kfEase", { easing: easing[v] });
        }} />
        <View className="flex-row flex-wrap gap-2"><Button size="sm" variant="secondary" title={words("Copy keyframes")} onPress={copyKeyframes} /><Button size="sm" variant="secondary" title={words("Paste keyframes")} disabled={!keyframeClipboard.current.length} onPress={pasteKeyframes} /></View>
        <Label>Keyframe timeline</Label>
        <View className="flex-row flex-wrap gap-2">
          <Button size="sm" variant="secondary" title={words("Previous")} onPress={() => void studioKeyframeAction("kfStep", { direction: -1 })} />
          <Button size="sm" variant="secondary" title={words("Next")} onPress={() => void studioKeyframeAction("kfStep", { direction: 1 })} />
          <Button size="sm" variant="secondary" title={words("Delete keyframe")} onPress={() => void studioKeyframeAction("kfRemove")} />
          <Button size="sm" variant="danger" title={words("Clear all")} onPress={() => void studioKeyframeAction("kfClear")} />
        </View>
      </View>;
      case "tr": return <Choices items={TRANSITIONS} on={TRANSITIONS[TRANSITION_IDS.indexOf(clip?.transition ?? "hard")] ?? "Cut"} onPick={(label) => {
        const transition = TRANSITION_IDS[TRANSITIONS.indexOf(label)] ?? "hard";
        patch({ transition }); void studioStyle("transition", transition);
      }} />;
      case "fx": return <Choices items={EFFECTS} on={EFFECTS[EFFECT_IDS.indexOf(clip?.effect ?? "none")] ?? "None"} onPick={(label) => {
        const effect = EFFECT_IDS[EFFECTS.indexOf(label)] ?? "none";
        patch({ effect }); void studioStyle("effect", effect);
      }} />;
      case "adjust": return <View className="gap-2">{p.studio && <FineTune key={`a${selected}`} fields={ADJUST_FINE} patch={studioPatch} />}<Choices items={["Reset colour", "Brighten", "More contrast", "Warm cinematic", "Vivid colour", "Matte film"]} onPick={(v) => {
        const values: Record<string, Record<string, number>> = {
          "Reset colour": { bri: 0, con: 0, sat: 0, warm: 0, hi: 0, sh: 0, hue: 0, sharp: 0, vig: 0 },
          Brighten: { bri: 0.18, sh: 0.2 }, "More contrast": { con: 0.22, hi: -0.08 },
          "Warm cinematic": { warm: 0.28, con: 0.12, vig: 0.18 }, "Vivid colour": { sat: 0.28, sharp: 0.12 },
          "Matte film": { con: -0.12, sat: -0.16, sh: 0.18, vig: 0.22 },
        }; void studioPatch(values[v]);
      }} /></View>;
      case "curve": return <Choices items={["Montage", "Hero moment", "Bullet", "Smooth", "Reset curve"]} onPick={(v) => {
        const curves: Record<string, { a: number; b: number; c: number; d: number; e: number }> = {
          Montage: { a: 1.8, b: 2.4, c: 1, d: 2.4, e: 1.8 }, "Hero moment": { a: 1.8, b: 1.2, c: 0.45, d: 0.7, e: 1.8 },
          Bullet: { a: 0.45, b: 0.8, c: 2.8, d: 2.2, e: 1.4 }, Smooth: { a: 0.85, b: 0.95, c: 1, d: 1.05, e: 1.15 },
          "Reset curve": { a: 1, b: 1, c: 1, d: 1, e: 1 },
        }; void studioPatch({ curve: curves[v] });
      }} />;
      case "kf": return <View className="gap-2"><Choices items={["Add keyframe here", "Remove this keyframe", "Remove all keyframes"]} onPick={(v) => void studioPatch({ kxOp: v.startsWith("Add") ? "add" : v.startsWith("Remove this") ? "del" : "clear" })} />
        <Text className="text-[12px] leading-[17px] text-muted">{words("Saves the shot's colour, volume, zoom, framing and mask here. Move the playhead, change Adjust, Volume, Crop or Mask, and the shot glides between the keys.")}</Text></View>;
      case "smooth": return <Choices items={["Off", "Light", "Smooth", "Smoothest"]} onPick={(v) => void studioPatch({ smooth: ({ Off: 0, Light: 0.4, Smooth: 0.75, Smoothest: 1 } as Record<string, number>)[v] })} />;
      case "stab": return <Choices items={["Off", "Light", "Balanced", "Strong"]} onPick={(v) => void studioPatch({ stab: ({ Off: 0, Light: 0.25, Balanced: 0.55, Strong: 0.85 } as Record<string, number>)[v] })} />;
      case "beauty": return <Choices items={["Off", "Natural", "Soft", "Smooth"]} onPick={(v) => void studioPatch({ beauty: ({ Off: 0, Natural: 0.2, Soft: 0.45, Smooth: 0.7 } as Record<string, number>)[v] })} />;
      case "fade": return <Choices items={["No fade", "Fade in", "Fade out", "Fade both", "Fade both, every shot"]} onPick={(v) => {
        const values: Record<string, Record<string, number>> = { "No fade": { fin: 0, fout: 0 }, "Fade in": { fin: 0.5, fout: 0 }, "Fade out": { fin: 0, fout: 0.6 }, "Fade both": { fin: 0.5, fout: 0.6 }, "Fade both, every shot": { fin: 0.3, fout: 0.3 } };
        void studioPatch(v.endsWith("every shot") ? { ...values[v], all: true } : values[v]);
      }} />;
      case "mosaic": return <Choices items={["Add mosaic region", "Remove mosaic", "Blur centre region"]} onPick={(v) => void studioPatch({ mz: v === "Remove mosaic" ? null : { x: v === "Blur centre region" ? 0.32 : 0.3, y: 0.25, w: 0.4, h: 0.25, s: 0.035 } })} />;
      case "lens": return <Choices items={["Add magnifier", "Remove magnifier", "Zoom 1.5×", "Zoom 2×", "Zoom 3×"]} onPick={(v) => {
        if (v === "Remove magnifier") return void studioPatch({ mg: null });
        void studioPatch({ mg: { x: 0.5, y: 0.45, r: 0.18, z: v === "Zoom 1.5×" ? 1.5 : v === "Zoom 2×" ? 2 : v === "Zoom 3×" ? 3 : 2 } });
      }} />;
      // a mask on the shot (the website's Clip tools -> Mask): the shot shows inside the shape, black around it
      case "mask": return <View className="gap-2">{p.studio && <FineTune key={`m${selected}`} fields={MASK_FINE} patch={studioPatch} />}<Choices items={["Circle", "Rectangle", "Heart", "Star", "Split", "Filmstrip", "Invert", "Remove mask"]} onPick={(v) => {
        if (v === "Remove mask") return void studioPatch({ mk: null });
        if (v === "Invert") return void (async () => { const c = await engine.tool("shotCs").catch(() => null) as { mk?: Record<string, unknown> | null } | null; if (c?.mk) void studioPatch({ mk: { ...c.mk, inv: !c.mk.inv } }); })();
        const s = ({ Circle: "circle", Rectangle: "rect", Heart: "heart", Star: "star", Split: "split", Filmstrip: "film" } as Record<string, string>)[v];
        void studioPatch({ mk: { s, x: 0.5, y: 0.5, w: 0.7, h: s === "film" ? 0.5 : 0.7, a: 0, f: 0.04, inv: false, c: "#000000" } });
      }} /></View>;
      // green screen on the shot (the website's Clip tools -> Chroma key): the colour goes, black shows behind
      case "chroma": return <Choices items={["Green screen", "Blue screen", "Stronger", "Softer", "Remove chroma key"]} onPick={(v) => void (async () => {
        if (v === "Remove chroma key") return void studioPatch({ ck: null });
        const c = await engine.tool("shotCs").catch(() => null) as { ck?: { c: string; tol: number; bg: string } | null } | null, ck = c?.ck ?? { c: "#00FF00", tol: 0.35, bg: "#000000" };
        void studioPatch({ ck: v === "Green screen" ? { ...ck, c: "#00FF00" } : v === "Blue screen" ? { ...ck, c: "#0000FF" } : { ...ck, tol: Math.max(0.05, Math.min(0.9, ck.tol + (v === "Stronger" ? 0.1 : -0.1))) } });
      })()} />;
      // Curves and HSL (the website's Clip tools): ready-made curves, and one colour band at a time
      case "curves": return <View className="gap-2">{p.studio && <FineTune key={`c${selected}`} fields={CURVE_FINE} patch={studioPatch} />}<Choices items={["More contrast", "Faded film", "Brighter mids", "Moody", "Cross process", "Reset curves"]} onPick={(v) => void studioPatch({ cv: ({
        "More contrast": { m: [0, 0.18, 0.5, 0.82, 1] }, "Faded film": { m: [0.1, 0.3, 0.52, 0.76, 0.94] }, "Brighter mids": { m: [0, 0.32, 0.6, 0.83, 1] },
        Moody: { m: [0, 0.2, 0.45, 0.72, 0.95], b: [0.05, 0.28, 0.52, 0.75, 0.97] }, "Cross process": { r: [0, 0.2, 0.55, 0.85, 1], g: [0, 0.25, 0.52, 0.8, 1], b: [0.12, 0.3, 0.48, 0.66, 0.85] },
      } as Record<string, unknown>)[v] ?? null })} /></View>;
      case "hsl": return <Choices items={["Bluer sky", "Warm skin", "Greener leaves", "Only red in colour", "Teal & orange", "Reset HSL"]} onPick={(v) => void studioPatch({ hsl: ({
        "Bluer sky": { blue: [0, 0.45, -0.1], aqua: [0.1, 0.3, 0] }, "Warm skin": { orange: [-0.05, 0.15, 0.1], red: [0.05, -0.1, 0.05] }, "Greener leaves": { green: [0, 0.5, -0.05], yellow: [0.15, 0.2, 0] },
        "Only red in colour": { orange: [0, -1, 0], yellow: [0, -1, 0], green: [0, -1, 0], aqua: [0, -1, 0], blue: [0, -1, 0], purple: [0, -1, 0], magenta: [0, -0.6, 0] },
        "Teal & orange": { green: [0.35, -0.2, 0], aqua: [0.1, 0.3, 0], blue: [-0.15, 0.2, -0.1], orange: [0, 0.3, 0.05], yellow: [-0.2, 0.1, 0] },
      } as Record<string, unknown>)[v] ?? null })} />;
      case "border": return <Choices items={["No border", "Fine white", "Gold frame", "Soft frame"]} onPick={(v) => {
        if (v === "No border") return void studioPatch({ fit: false, bd: 0 });
        void studioPatch({ fit: true, bd: v === "Fine white" ? 0.035 : 0.08, bdc: v === "Gold frame" ? "#d4b07a" : v === "Soft frame" ? "#f3ede3" : "#ffffff" });
      }} />;
      case "extract": return <Button full icon="music" title={words("Extract clip audio")} onPress={() => void (async () => {
        try { await engine.tool("seek", { time: now }); await engine.tool("shotExtract"); toast(words("Audio extracted"), "success"); }
        catch (e) { toast(errorMessage(e), "danger"); }
      })()} />;
      case "vol": return <Choices items={VOLUMES} on={clip?.muted ? "0%" : `${Math.round((clip?.volume ?? 1) * 100)}%`} onPick={(v) => { const volume = parseInt(v) / 100; patch({ volume, muted: v === "0%" }); void studioPatch({ vol: v === "0%" ? 0 : volume }); }} />;
      case "trim": return clip && (
        <View className="gap-2">
          <Text className="text-center text-[13px] text-muted">{clip.start.toFixed(1)}s – {clip.end.toFixed(1)}s · {(clip.end - clip.start).toFixed(1)}s</Text>
          <View className="flex-row gap-2"><Button className="flex-1" variant="secondary" title={words("Start later")} onPress={() => patch({ start: Math.min(clip.end - 0.3, clip.start + 0.25) })} /><Button className="flex-1" variant="secondary" title={words("End sooner")} onPress={() => patch({ end: Math.max(clip.start + 0.3, clip.end - 0.25) })} /></View>
          <View className="flex-row gap-2"><Button className="flex-1" variant="secondary" title={words("Start sooner")} onPress={() => patch({ start: Math.max(0, clip.start - 0.25) })} /><Button className="flex-1" variant="secondary" title={words("End later")} onPress={() => patch({ end: Math.min(clip.sourceDuration, clip.end + 0.25) })} /></View>
        </View>
      );
    }
    return null;
  }

  if (!p) return <View className="flex-1 bg-background" />;
  const aspect = ASPECT[p.settings?.aspect ?? "9:16"];
  return (
    <View className="flex-1 bg-background">
      <StudioBar title={p.title} saved={saved} onBack={back} onExport={() => { if (!videoEngine.ready) return toast(words("Export needs the Shubix app (Expo Go has no video engine). Your Reel is saved on this phone."), "info"); setPlaying(false); setExporting(p); }} />
      <ScrollView className="flex-1" contentContainerClassName="pb-3" showsVerticalScrollIndicator={false}>
        <Preview clip={clip} next={clips[selected + 1]} n={selected} of={clips.length} playing={playing} at={local} now={now} overlays={p.overlays} still={still} aspect={aspect} beat={p.music?.bpm ? 60 / p.music.bpm : undefined} onToggle={() => setPlaying(!playing)} onTime={setLocal} onEnded={ended} />
        <View className="mx-4 mt-2">
          <Button full icon="shuffle" variant="secondary" title={words(mixing ? "Mixing video…" : "Mix Video")} disabled={mixing || clips.length < 2} onPress={() => void mixVideo()} />
        </View>
        <Transport now={now} total={total} playing={playing} sound={sound} onPrev={() => go(selected - 1)} onToggle={() => setPlaying(!playing)} onNext={() => go(selected + 1)} onSound={() => setSound(!sound)} />
        <View className="mx-4 mt-3"><AskShubix onAsk={async (t) => {
          // a Reel the studio made and still holds: Shubix AI itself (the website's chat: its credit question asked here,
          // its plan applied there, the clips back here); otherwise the phone's own changes below
          if (p.studio && engine.holds(p.id)) {
            try {
              setPlaying(false);
              const r = await engine.chat(p, t);
              if (r) {
                if (r.clips) { const next = r.clips; setP((old) => old ? { ...old, clips: next, ...(r.overlays ? { overlays: r.overlays } : {}), studio: true } : old); setSelected(0); }
                return r.answer;
              }
            } catch (e) { return errorMessage(e); }
          }
          const bulk = parseBulkVisualCommand(t);
          if (bulk?.unsupportedTransition) {
            return words("{transition} is not available in the current Android export engine yet. I did not change your clips. Choose Fade in, Whip pan, Zoom, Flash, Spin, Slide, Blur or Swipe up instead.", { transition: words(bulk.unsupportedTransition) });
          }
          if (bulk && clips.length) {
            const effectChoices = ["punch-soft", "pan-soft", "drift", "bounce", "tilt"];
            let previous = "";
            setClips(clips.map((c, i) => {
              const patch: Partial<ProjectClip> = {};
              if (bulk.transition) patch.transition = bulk.transition;
              if (bulk.effect) {
                const choice = effectChoices.find((item) => item !== previous) ?? effectChoices[0];
                patch.effect = choice; previous = choice;
              }
              return { ...c, ...patch };
            }));
            const applied = [bulk.transition ? "transitions" : "", bulk.effect ? "effects" : ""].filter(Boolean).join(" and ");
            return words("Done ✓ Applied {applied} to all {count} clips on this device. No AI credits used.", { applied: words(applied), count: clips.length });
          }
          const style = styleFromWords(t);
          if (!style) return words("This Reel is edited on your phone, so I can switch its style or apply transitions and effects to every clip.");
          setClips(clips.map((c) => ({ ...c, speed: style === "fast" ? 1.25 : 0.8 })));
          return words("Done ✓ I used {style} (on your phone).", { style: words(style === "fast" ? "the Fast style" : "the Smooth style") });
        }} /></View>
        <Timeline clips={clips} selected={selected} overlays={p.overlays} studioLayers={studioLayers} onLayer={(index) => { setStudioLayerIndex(index); setTool({ key: "layers", name: "Layers" }); }} song={p.audioName} now={now} playing={playing} onSelect={go} onSeek={seek} onTrim={trimTimelineClip} onMove={moveTimelineClip} onAddClip={() => void addClips()} onText={() => setTool({ key: "text", name: "Text" })} onVoice={() => use("voice", "Voice")} onMusic={() => setTool({ key: "music", name: "Music" })} />
        <View className="mt-3 flex-row items-center justify-between px-4">
          <Text className="text-[13px] font-semibold text-foreground">{words("Shot")} {String(selected + 1).padStart(2, "0")} · {clip ? clipDuration(clip).toFixed(1) : "0.0"} s</Text>
          <View className="flex-row items-center gap-1"><IconButton icon="undo" size={36} label={words("Undo")} disabled={!undo.current.length && !(p.studio && engine.holds(p.id))} onPress={() => { void (async () => {
            if (p.studio && engine.holds(p.id)) {
              try {
                const studioStep = await engine.undo();
                if (studioStep.ok) {
                  setP((old) => old ? { ...old, clips: studioStep.clips, ...(studioStep.overlays ? { overlays: studioStep.overlays } : {}) } : old);
                  setSelected((i) => Math.min(i, Math.max(0, studioStep.clips.length - 1)));
                  // Layers live in the hidden Studio document, not ReelProject. Refresh their
                  // native controls after history navigation so masks/transforms don't look stale.
                  try {
                    const layers = await engine.tool("layerList");
                    if (Array.isArray(layers)) {
                      setStudioLayers(layers as typeof studioLayers);
                      setStudioLayerIndex((index) => Math.max(0, Math.min(index, layers.length - 1)));
                    }
                  } catch (error) { console.warn("Studio layers could not be refreshed after undo:", error); }
                  return;
                }
              } catch (error) { console.warn("Studio undo unavailable; using phone history:", error); }
            }
            const step = stepEditHistory(undo.current, redo.current, p, "undo", 30);
            if (step) { undo.current = step.undo; redo.current = step.redo; setP(step.current); }
          })(); }} /><IconButton icon="redo" size={36} label={words("Redo")} disabled={!redo.current.length && !(p.studio && engine.holds(p.id))} onPress={() => { void (async () => {
            if (p.studio && engine.holds(p.id)) {
              try {
                const studioStep = await engine.redo();
                if (studioStep.ok) {
                  setP((old) => old ? { ...old, clips: studioStep.clips, ...(studioStep.overlays ? { overlays: studioStep.overlays } : {}) } : old);
                  setSelected((i) => Math.min(i, Math.max(0, studioStep.clips.length - 1)));
                  // Restore the layer list from Studio's history along with the clip state.
                  try {
                    const layers = await engine.tool("layerList");
                    if (Array.isArray(layers)) {
                      setStudioLayers(layers as typeof studioLayers);
                      setStudioLayerIndex((index) => Math.max(0, Math.min(index, layers.length - 1)));
                    }
                  } catch (error) { console.warn("Studio layers could not be refreshed after redo:", error); }
                  return;
                }
              } catch (error) { console.warn("Studio redo unavailable; using phone history:", error); }
            }
            const step = stepEditHistory(undo.current, redo.current, p, "redo", 30);
            if (step) { undo.current = step.undo; redo.current = step.redo; setP(step.current); }
          })(); }} /></View>
        </View>
      </ScrollView>
      <View className="border-t border-border bg-bar pb-2 pt-2">
        <ToolRow items={[...DOCK.map((t) => ({ ...t, tag: locked?.(t.key) ? locked(t.key).toUpperCase() : undefined })), ...SHOT_TOOLS]} on={tool?.key} onPress={(k) => { const t = [...DOCK, ...SHOT_TOOLS].find((x) => x.key === k)!; use(k, t.name); }} />
      </View>
      <ExportScreen reel={exporting} onClose={() => setExporting(null)} />
      <ToolSheet tool={tool} onClose={() => setTool(null)}>{sheet()}</ToolSheet>
    </View>
  );
}
