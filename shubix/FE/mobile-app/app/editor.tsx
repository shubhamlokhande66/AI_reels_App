import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useStudioText } from "@shubix/hooks";
import { Button, IconButton, confirmAction, toast, useColors } from "@shubix/ui-mobile";
import { errorMessage } from "@shubix/api-client";
import { clipDuration, projectDuration, splitClip, type ProjectClip, type ReelProject } from "@shubix/validations";
import { getProject, keepPickedAssets, keepPickedFile, saveProject } from "../lib/projects";
import { pickSong } from "../lib/songs";
import { useLocked } from "../lib/data";
import { AskShubix, styleFromWords } from "../components/organisms/AskShubix";
import { ExportScreen } from "../components/organisms/ExportScreen";
import { videoEngine } from "../lib/video";
import { Choices, DOCK, Preview, SHOT_TOOLS, StudioBar, Timeline, ToolRow, ToolSheet, Transport } from "../components/organisms/EditorParts";

type Overlay = ReelProject["overlays"][number];
const FILTERS = ["Original", "Golden", "Film", "Noir", "Soft", "Vivid", "Cinematic"];
const TRANSITIONS = ["Cut", "Fade", "Dissolve", "Push", "Wipe", "Zoom", "Flash", "Blur"];
const SPEEDS = ["0.5×", "0.75×", "1×", "1.25×", "1.5×", "2×", "3×"];
const VOLUMES = ["0%", "25%", "50%", "75%", "100%", "150%"];
const STICKERS = ["✨", "🔥", "❤️", "😂", "🎉", "⭐", "👀", "💯"];
const ASPECT: Record<string, number> = { "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9 };
// the tools the phone cannot do yet (they need the video engine the export uses): a line instead of a sheet
const LATER = new Set(["fx", "extract", "border", "adjust", "curve", "stab", "beauty", "fade", "mosaic", "lens", "captions", "voice", "layers"]);
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
  useEffect(() => { if (!p?.audioUri) return; if (playing && sound) { song.seekTo(now).catch(() => {}); song.play(); } else song.pause(); }, [playing, sound, p?.audioUri]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: Partial<ReelProject>) => setP((old) => { if (!old) return old; undo.current = [...undo.current.slice(-29), old]; return { ...old, ...next, studio: false }; }); // changed here: the phone's export makes it (the studio holds the Reel as it made it)
  const setClips = (next: ProjectClip[]) => { change({ clips: next }); setSelected((i) => Math.min(i, Math.max(0, next.length - 1))); };
  const patch = (x: Partial<ProjectClip>) => clip && setClips(clips.map((c, i) => (i === selected ? { ...c, ...x } : c)));
  const go = (i: number) => { setSelected(Math.max(0, Math.min(clips.length - 1, i))); setLocal(0); };
  // a place on the timeline: the shot there and the time in it
  const seek = (t: number) => { let i = 0, start = 0; while (i < clips.length - 1 && start + clipDuration(clips[i]) <= t) start += clipDuration(clips[i++]); setSelected(i); setLocal(t - start); };
  const ended = useCallback(() => { setLocal(0); setSelected((i) => { if (i + 1 < (p?.clips.length ?? 0)) return i + 1; setPlaying(false); return 0; }); }, [p?.clips.length]);

  async function addClips(replace = false) {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos", "images"], allowsMultipleSelection: !replace, selectionLimit: 30, quality: 0.9 });
    if (r.canceled || !r.assets.length || !p) return;
    try {
      const got = await keepPickedAssets(`${p.id}-${Date.now()}`, r.assets);
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
      case "look": return <Choices items={FILTERS} on={clip?.filter} onPick={(filter) => patch({ filter })} />;
      case "style": return <Choices items={["Editorial", "Cinematic", "Warm", "Clean"]} onPick={(v) => patch({ filter: v === "Warm" ? "Golden" : v === "Clean" ? "Original" : v === "Editorial" ? "Film" : v })} />;
      case "shots": return <><Choices items={clips.map((_, i) => `${words("Shot")} ${i + 1}`)} on={`${words("Shot")} ${selected + 1}`} onPick={(v) => go(Number(v.split(" ").pop()) - 1)} /><Button full variant="secondary" icon="plus" title={words("Add shot")} onPress={() => void addClips()} /></>;
      case "music": return (
        <View className="gap-2">
          <Text className="text-[13px] text-foreground">{p.audioName ?? words("No song yet")}</Text>
          <Button full icon="music" title={words(p.audioUri ? "Change song" : "Choose song")} onPress={() => void chooseSong()} />
          {p.audioUri && <Button full variant="danger" icon="trash" title={words("Remove music")} onPress={() => change({ audioUri: undefined, audioName: undefined })} />}
          {clip && <Button full variant="secondary" title={words(clip.muted ? "Turn the clip's sound on" : "Mute the clip's sound")} onPress={() => patch({ muted: !clip.muted })} />}
        </View>
      );
      case "text": return (
        <View className="gap-2">
          <TextInput value={draft} onChangeText={setDraft} placeholder={words("Type your text")} placeholderTextColor={look.muted} maxLength={80} className="h-12 rounded-xl border border-border bg-surface-2 px-4 text-[14px] text-foreground" />
          <Button full icon="plus" disabled={!draft.trim()} title={words("Add text")} onPress={() => addText(draft)} />
          {p.overlays.map((o) => <View key={o.id} className="flex-row items-center gap-2 rounded-xl border border-border px-3 py-2"><Text numberOfLines={1} className="flex-1 text-[13px] text-foreground">{o.text}</Text><IconButton icon="trash" look="danger" size={32} label={words("Delete")} onPress={() => change({ overlays: p.overlays.filter((x) => x.id !== o.id) })} /></View>)}
        </View>
      );
      case "bg": case "canvas": case "crop": return <Choices items={["Fill", "Fit"]} on={clip?.fit === "contain" ? "Fit" : "Fill"} onPick={(v) => patch({ fit: v === "Fit" ? "contain" : "cover" })} />;
      case "motion": case "sp": return <Choices items={SPEEDS} on={`${clip?.speed}×`} onPick={(v) => patch({ speed: parseFloat(v) })} />;
      case "tr": return <Choices items={TRANSITIONS} on={clip?.transition} onPick={(transition) => patch({ transition })} />;
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
        <Preview clip={clip} n={selected} of={clips.length} playing={playing} at={local} aspect={aspect} onToggle={() => setPlaying(!playing)} onTime={setLocal} onEnded={ended} />
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
