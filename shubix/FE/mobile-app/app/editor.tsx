import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useStudioText } from "@shubix/hooks";
import { Button, IconButton, Segmented, confirmAction, toast, useColors } from "@shubix/ui-mobile";
import { errorMessage } from "@shubix/api-client";
import { clipDuration, projectDuration, splitClip, type ProjectClip, type ReelProject } from "@shubix/validations";
import { getProject, keepPickedAssets, keepPickedFile, saveProject } from "../lib/projects";
import { pickSong } from "../lib/songs";
import { useLocked } from "../lib/data";
import { AskShubix, styleFromWords } from "../components/organisms/AskShubix";
import { ExportScreen } from "../components/organisms/ExportScreen";
import { pickInOrder } from "../components/organisms/Gallery";
import { videoEngine } from "../lib/video";
import { engine } from "../lib/engine";
import { Choices, DOCK, Preview, SHOT_TOOLS, StudioBar, Timeline, ToolRow, ToolSheet, Transport } from "../components/organisms/EditorParts";

type Overlay = ReelProject["overlays"][number];
const FILTERS = ["Original", "Golden", "Film", "Noir", "Soft", "Vivid", "Cinematic"];
const TRANSITIONS = ["Cut", "Fade in", "Dissolve", "Whip pan", "Zoom", "Flash", "Glitch", "Dip to black", "Iris", "Soft wipe", "Spin", "Push left", "Push right", "Push up", "Push down", "Light fade", "Film burn", "Ripple"];
const TRANSITION_IDS = ["hard", "fadein", "dissolve", "whip", "zoom", "flash", "glitch", "dip", "iris", "wipe", "spin", "slideleft", "slideright", "slideup", "slidedown", "luma", "burn", "ripple"];
const EFFECTS = ["None", "Punch-in", "Soft zoom", "Ken Burns", "Zoom burst", "Slow drift", "Shake", "Beat bounce", "Tilt punch", "Photo snap", "Hook zoom", "Frame in frame", "Kaleidoscope", "VHS retro"];
const EFFECT_IDS = ["none", "punch", "punch-soft", "pan-soft", "zoomburst", "drift", "shake", "bounce", "tilt", "snap", "hook", "frame", "kaleido", "vhs"];
const SPEEDS = ["0.5×", "0.75×", "1×", "1.25×", "1.5×", "2×", "3×"];
const VOLUMES = ["0%", "25%", "50%", "75%", "100%", "150%"];
const STICKERS = ["✨", "🔥", "❤️", "😂", "🎉", "⭐", "👀", "💯"];
// the website's tool panels (components/studio/markup.ts): their choices, as its buttons' values and names
const MODES = [["auto", "Auto"], ["smooth", "Smooth"], ["fast", "Fast"]];
const MODE_HELP: Record<string, string> = {
  auto: "Auto: the music decides. Calm parts get longer shots, drops and hits get effects.",
  smooth: "Smooth: fewer, longer shots on the strong beats, soft camera moves, no flashy effects.",
  fast: "Fast: a cut on every beat, a transition on every cut, punches and speed changes on the hits.",
};
// …a look's filter when the phone makes the Reel
const LOOKS = [["natural", "Natural", "Original"], ["vivid", "Vivid", "Vivid"], ["cine", "Cinematic", "Cinematic"], ["mono", "B&W", "Noir"]];
const TSTYLES = [["pop", "Pop"], ["karaoke", "Karaoke"], ["box", "Box"], ["clean", "Clean"]];
const CSNDS = [["mute", "Mute it"], ["voices", "Keep voices only"], ["all", "Keep all"]];
const BGS = [["none", "Original"], ["blur", "Blur"]];
const READY_MADE = ["Follow for more", "Save this", "Step 1", "BEFORE", "AFTER", "गणपती बाप्पा मोरया", "शुभ दीपावली", "Happy Diwali"];
const ASPECT: Record<string, number> = { "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9 };
// the tools the phone cannot do yet (they need the video engine the export uses): a line instead of a sheet
const LATER = new Set(["captions", "voice", "layers"]);
// …and Export needs the video engine, which a development or Play Store build has (Expo Go has not)

/** The editor (the website's studio editor on a phone): the Reel saved on this phone, played shot by shot with its
 * song; the timeline and the tools change it, every change is kept (undo), and it saves itself as it goes. */
export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(), words = useStudioText(), look = useColors(), locked = useLocked();
  const [p, setP] = useState<ReelProject | null>(null), [selected, setSelected] = useState(0), [playing, setPlaying] = useState(false), [local, setLocal] = useState(0);
  const [exporting, setExporting] = useState<ReelProject | null>(null), [sound, setSound] = useState(true), [saved, setSaved] = useState(true), [tool, setTool] = useState<{ key: string; name: string } | null>(null), [draft, setDraft] = useState("");
  const undo = useRef<ReelProject[]>([]), song = useAudioPlayer(p?.audioUri ?? null);
  useEffect(() => { void getProject(id).then((x) => { if (x) setP(x); else { toast(words("This draft is no longer on this phone."), "danger"); router.back(); } }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // the song plays with the Reel, from where the Reel is
  useEffect(() => { void setAudioModeAsync({ interruptionMode: "mixWithOthers", playsInSilentMode: true }).catch(() => {}); }, []); // the song and the shots play together
  useEffect(() => { if (!p?.audioUri) return; if (playing && sound) { song.seekTo(now + (p.settings?.start ?? 0)).catch(() => {}); song.play(); } else song.pause(); }, [playing, sound, p?.audioUri]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: Partial<ReelProject>) => setP((old) => { if (!old) return old; undo.current = [...undo.current.slice(-29), old]; return { ...old, ...next, studio: next.studio ?? (old.studio && !("audioUri" in next) && !("overlays" in next)) }; }); // the song or the texts changed: the phone's export makes it (the clips' changes go back to the studio: engine.edit)
  const setClips = (next: ProjectClip[]) => { change({ clips: next }); setSelected((i) => Math.min(i, Math.max(0, next.length - 1))); };
  const patch = (x: Partial<ProjectClip>) => clip && setClips(clips.map((c, i) => (i === selected ? { ...c, ...x } : c)));
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
  const studioKeyframe = async (values: Record<string, number>) => {
    if (!p || !p.studio || !engine.holds(p.id)) return toast(words("Keyframes need a Reel made by Shubix Studio."), "info");
    try { await engine.tool("kfSeek", { time: now }); const result = await engine.tool("kfSet", { values }); if (Array.isArray(result.keyframes)) patch({ keyframes: result.keyframes as ProjectClip["keyframes"] }); toast(words("Keyframe added at the playhead"), "success"); }
    catch (e) { toast(errorMessage(e), "danger"); }
  };
  const go = (i: number) => { setSelected(Math.max(0, Math.min(clips.length - 1, i))); setLocal(0); };
  // a place on the timeline: the shot there and the time in it
  const seek = (t: number) => { let i = 0, start = 0; while (i < clips.length - 1 && start + clipDuration(clips[i]) <= t) start += clipDuration(clips[i++]); setSelected(i); setLocal(t - start); };
  const ended = useCallback(() => { setLocal(0); setSelected((i) => { if (i + 1 < (p?.clips.length ?? 0)) return i + 1; setPlaying(false); return 0; }); }, [p?.clips.length]);

  async function addClips(replace = false) {
    const assets = await pickInOrder({ kind: "both", limit: replace ? 1 : 30 }); // in the order tapped
    if (!assets?.length || !p) return;
    try {
      const got = await keepPickedAssets(`${p.id}-${Date.now()}`, assets);
      setClips(replace && clip ? clips.map((c, i) => (i === selected ? { ...got[0], id: c.id } : c)) : [...clips, ...got]);
    } catch (e) { toast(errorMessage(e), "danger"); }
  }
  async function chooseSong() {
    if (!p) return;
    try { const s = await pickSong(); if (s) change({ audioUri: await keepPickedFile(p.id, s.uri, `${s.name}.m4a`), audioName: s.name }); } catch (e) { toast(errorMessage(e), "danger"); }
  }
  async function removeShot() {
    if (clips.length === 1) return toast(words("A Reel needs at least one shot."), "info");
    if (await confirmAction({ title: words("Delete this shot?"), ok: words("Delete"), danger: true })) setClips(clips.filter((_, i) => i !== selected));
  }
  const addText = (text: string) => { if (!text.trim()) return; change({ overlays: [...(p?.overlays ?? []), { id: `t-${Date.now()}`, text: text.trim(), start: now, end: Math.min(total, now + 3) || 3, color: "#FFFFFF", size: 36 } as Overlay] }); setDraft(""); };

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
    if (lock) { router.push("/pricing"); return; }
    if (LATER.has(key)) return toast(words("{tool} comes with the phone's video engine, in the Play Store app.", { tool: words(name) }), "info");
    if (!clip) return;
    const s = clip.end - clip.start;
    switch (key) {
      case "split": { const r = splitClip(clip, `${clip.id}-${Date.now()}`); if (!r) return toast(words("Keep at least a small moment on each side of the split."), "info"); setClips(clips.flatMap((c, i) => (i === selected ? r : [c]))); return; }
      case "dup": setClips([...clips.slice(0, selected + 1), { ...clip, id: `${clip.id}-${Date.now()}` }, ...clips.slice(selected + 1)]); return go(selected + 1);
      case "freeze": return patch({ speed: 0.25 });
      case "other": case "slip": { const room = clip.sourceDuration - s; return room > 0.1 ? patch({ start: (clip.start + 1) % room, end: ((clip.start + 1) % room) + s }) : toast(words("This clip has no other moment."), "info"); }
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
          <View className="mt-1 gap-1.5 rounded-xl border border-border bg-surface-2 p-3">
            <Text className="text-[13px] font-semibold text-foreground">{words("Your clips have their own sound")}</Text>
            <Text className="text-[12px] leading-[17px] text-muted">{words("Wind, traffic, people talking… Choose what the Reel keeps under the song.")}</Text>
            <Seg k="csnd" items={CSNDS} box="csnd" attr="data-c" here={(v) => ({ clips: clips.map((c) => ({ ...c, muted: v === "mute" })) })} />
          </View>
          {p.audioUri && <Button full variant="danger" icon="trash" title={words("Remove music")} onPress={() => change({ audioUri: undefined, audioName: undefined })} />}
          {clip && <Button full variant="secondary" title={words(clip.muted ? "Turn the clip's sound on" : "Mute the clip's sound")} onPress={() => patch({ muted: !clip.muted })} />}
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
          {p.overlays.map((o) => <View key={o.id} className="flex-row items-center gap-2 rounded-xl border border-border px-3 py-2"><Text numberOfLines={1} className="flex-1 text-[13px] text-foreground">{o.text}</Text><IconButton icon="trash" look="danger" size={32} label={words("Delete")} onPress={() => change({ overlays: p.overlays.filter((x) => x.id !== o.id) })} /></View>)}
        </View>
      );
      case "bg": return <Seg k="bg" items={BGS} box="bgmode" attr="data-b" />;
      case "canvas": case "crop": return <Choices items={["Fill", "Fit"]} on={clip?.fit === "contain" ? "Fit" : "Fill"} onPick={(v) => patch({ fit: v === "Fit" ? "contain" : "cover" })} />;
      case "sp": return <Choices items={SPEEDS} on={`${clip?.speed}×`} onPick={(v) => patch({ speed: parseFloat(v) })} />;
      case "motion": return <View className="gap-2">
        <Text className="text-[11px] text-muted">{words("Move the playhead, then add a keyframe. Add another at a later time to animate the move.")}</Text>
        <Choices items={["Zoom in", "Zoom out", "Slide left", "Slide right", "Move up", "Move down", "Rotate", "Fade", "Reset frame"]} onPick={(v) => {
          const values: Record<string, Record<string, number>> = {
            "Zoom in": { s: 1.2 }, "Zoom out": { s: 0.85 }, "Slide left": { x: -0.08 }, "Slide right": { x: 0.08 },
            "Move up": { y: -0.08 }, "Move down": { y: 0.08 }, Rotate: { r: 8 }, Fade: { o: 0.45 },
            "Reset frame": { x: 0, y: 0, s: 1, r: 0, o: 1 },
          }; void studioKeyframe(values[v]);
        }} />
      </View>;
      case "tr": return <Choices items={TRANSITIONS} on={TRANSITIONS[TRANSITION_IDS.indexOf(clip?.transition ?? "hard")] ?? "Cut"} onPick={(label) => {
        const transition = TRANSITION_IDS[TRANSITIONS.indexOf(label)] ?? "hard";
        patch({ transition }); void studioStyle("transition", transition);
      }} />;
      case "fx": return <Choices items={EFFECTS} on={EFFECTS[EFFECT_IDS.indexOf(clip?.effect ?? "none")] ?? "None"} onPick={(label) => {
        const effect = EFFECT_IDS[EFFECTS.indexOf(label)] ?? "none";
        patch({ effect }); void studioStyle("effect", effect);
      }} />;
      case "adjust": return <Choices items={["Reset colour", "Brighten", "More contrast", "Warm cinematic", "Vivid colour", "Matte film"]} onPick={(v) => {
        const values: Record<string, Record<string, number>> = {
          "Reset colour": { bri: 0, con: 0, sat: 0, warm: 0, hi: 0, sh: 0, hue: 0, sharp: 0, vig: 0 },
          Brighten: { bri: 0.18, sh: 0.2 }, "More contrast": { con: 0.22, hi: -0.08 },
          "Warm cinematic": { warm: 0.28, con: 0.12, vig: 0.18 }, "Vivid colour": { sat: 0.28, sharp: 0.12 },
          "Matte film": { con: -0.12, sat: -0.16, sh: 0.18, vig: 0.22 },
        }; void studioPatch(values[v]);
      }} />;
      case "curve": return <Choices items={["Montage", "Hero moment", "Bullet", "Smooth", "Reset curve"]} onPick={(v) => {
        const curves: Record<string, { a: number; b: number; c: number; d: number; e: number }> = {
          Montage: { a: 1.8, b: 2.4, c: 1, d: 2.4, e: 1.8 }, "Hero moment": { a: 1.8, b: 1.2, c: 0.45, d: 0.7, e: 1.8 },
          Bullet: { a: 0.45, b: 0.8, c: 2.8, d: 2.2, e: 1.4 }, Smooth: { a: 0.85, b: 0.95, c: 1, d: 1.05, e: 1.15 },
          "Reset curve": { a: 1, b: 1, c: 1, d: 1, e: 1 },
        }; void studioPatch({ curve: curves[v] });
      }} />;
      case "stab": return <Choices items={["Off", "Light", "Balanced", "Strong"]} onPick={(v) => void studioPatch({ stab: ({ Off: 0, Light: 0.25, Balanced: 0.55, Strong: 0.85 } as Record<string, number>)[v] })} />;
      case "beauty": return <Choices items={["Off", "Natural", "Soft", "Smooth"]} onPick={(v) => void studioPatch({ beauty: ({ Off: 0, Natural: 0.2, Soft: 0.45, Smooth: 0.7 } as Record<string, number>)[v] })} />;
      case "fade": return <Choices items={["No fade", "Fade in", "Fade out", "Fade both"]} onPick={(v) => {
        const values: Record<string, Record<string, number>> = { "No fade": { fin: 0, fout: 0 }, "Fade in": { fin: 0.5, fout: 0 }, "Fade out": { fin: 0, fout: 0.6 }, "Fade both": { fin: 0.5, fout: 0.6 } };
        void studioPatch(values[v]);
      }} />;
      case "mosaic": return <Choices items={["Add mosaic", "Remove mosaic", "Face blur area"]} onPick={(v) => void studioPatch({ mz: v === "Remove mosaic" ? null : { x: 0.3, y: 0.25, w: 0.4, h: 0.25, s: 0.035 } })} />;
      case "lens": return <Choices items={["Add magnifier", "Remove magnifier", "Zoom 1.5×", "Zoom 2×", "Zoom 3×"]} onPick={(v) => {
        if (v === "Remove magnifier") return void studioPatch({ mg: null });
        void studioPatch({ mg: { x: 0.5, y: 0.45, r: 0.18, z: v === "Zoom 1.5×" ? 1.5 : v === "Zoom 2×" ? 2 : v === "Zoom 3×" ? 3 : 2 } });
      }} />;
      case "border": return <Choices items={["No border", "Fine white", "Gold frame", "Soft frame"]} onPick={(v) => {
        if (v === "No border") return void studioPatch({ fit: false, bd: 0 });
        void studioPatch({ fit: true, bd: v === "Fine white" ? 0.035 : 0.08, bdc: v === "Gold frame" ? "#d4b07a" : v === "Soft frame" ? "#f3ede3" : "#ffffff" });
      }} />;
      case "extract": return <Button full icon="music" title={words("Extract clip audio")} onPress={() => void (async () => {
        try { await engine.tool("seek", { time: now }); await engine.tool("shotExtract"); toast(words("Audio extracted"), "success"); }
        catch (e) { toast(errorMessage(e), "danger"); }
      })()} />;
      case "vol": return <Choices items={VOLUMES} on={clip?.muted ? "0%" : `${Math.round((clip?.volume ?? 1) * 100)}%`} onPick={(v) => patch({ volume: parseInt(v) / 100, muted: v === "0%" })} />;
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
        <Preview clip={clip} n={selected} of={clips.length} playing={playing} at={local} aspect={aspect} beat={p.music?.bpm ? 60 / p.music.bpm : undefined} onToggle={() => setPlaying(!playing)} onTime={setLocal} onEnded={ended} />
        <Transport now={now} total={total} playing={playing} sound={sound} onPrev={() => go(selected - 1)} onToggle={() => setPlaying(!playing)} onNext={() => go(selected + 1)} onSound={() => setSound(!sound)} />
        <View className="mx-4 mt-3"><AskShubix onAsk={(t) => {
          const style = styleFromWords(t);
          if (!style) return words("This Reel is edited on your phone, so I can only switch its style (say \"faster\" or \"calmer\").");
          setClips(clips.map((c) => ({ ...c, speed: style === "fast" ? 1.25 : 0.8 })));
          return words("Done ✓ I used {style} (on your phone).", { style: words(style === "fast" ? "the Fast style" : "the Smooth style") });
        }} /></View>
        <Timeline clips={clips} selected={selected} overlays={p.overlays} song={p.audioName} now={now} playing={playing} onSelect={go} onSeek={seek} onAddClip={() => void addClips()} onText={() => setTool({ key: "text", name: "Text" })} onVoice={() => use("voice", "Voice")} onMusic={() => setTool({ key: "music", name: "Music" })} />
        <View className="mt-3 flex-row items-center justify-between px-4">
          <Text className="text-[13px] font-semibold text-foreground">{words("Shot")} {String(selected + 1).padStart(2, "0")} · {clip ? clipDuration(clip).toFixed(1) : "0.0"} s</Text>
          <IconButton icon="undo" size={36} label={words("Undo")} disabled={!undo.current.length} onPress={() => { const last = undo.current.pop(); if (last) setP(last); }} />
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
