import { useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { AudioLines, AudioWaveform, Captions, ChevronDown, CirclePlay, Clapperboard, Crop, Expand, Film, Layers, Music2, Pause, Plus, Settings2, Sparkles, Sticker, Type, WandSparkles, X } from "lucide-react-native";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";
import { clipDuration, makeClip, projectDuration, splitClip, type ClipAction, type ProjectClip, type ReelProject, type TimelineTool } from "@shubix/validations";
import { Surface, colors } from "@shubix/ui-mobile";
import { getProject, keepPickedAssets, keepPickedFile, listProjects, saveProject, type MobileProject } from "../../lib/projects";

const groups: { name: TimelineTool; icon: typeof Film; options: string[] }[] = [
  { name: "Media", icon: Film, options: ["Add clips", "Replace shot", "Reorder", "Remove"] },
  { name: "Stickers", icon: Sticker, options: ["Browse stickers", "Emoji", "Add sticker"] },
  { name: "Filters", icon: Sparkles, options: ["Original", "Golden", "Film", "Noir", "Soft", "Vivid"] },
  { name: "Style", icon: WandSparkles, options: ["Editorial", "Cinematic", "Warm", "Clean"] },
  { name: "Shots", icon: Clapperboard, options: ["Previous shot", "Next shot", "Add shot"] },
  { name: "Music", icon: Music2, options: ["Choose music", "Remove music", "Mute clip audio", "Volume", "Fade"] },
  { name: "Text", icon: Type, options: ["Add title", "Add text", "Edit text", "Remove text", "Fonts", "Animation"] },
  { name: "Captions", icon: Captions, options: ["Add captions", "Edit captions", "Caption style"] },
  { name: "Background", icon: Layers, options: ["Blur", "Color", "Image", "Fit canvas"] },
  { name: "Layers", icon: Layers, options: ["Add layer", "Reorder layers", "Opacity"] },
  { name: "Voice", icon: AudioLines, options: ["Add voice recording", "Text to speech", "Clean audio"] },
  { name: "Motion", icon: AudioWaveform, options: ["Speed curve", "Stabilize", "Keyframes"] },
];
const actions: ClipAction[] = ["Transition", "Effect", "Speed", "Split", "Duplicate", "Freeze", "Volume", "Extract audio", "Crop", "Reverse", "Rotate", "Mirror", "Flip", "Fit canvas", "Border", "Adjust", "Speed curve", "Stabilize", "Beauty", "Fade", "Mosaic", "Magnifier", "Slip", "Trim", "Reset", "Delete"];
const choices: Partial<Record<ClipAction | TimelineTool | (string & {}), string[]>> = {
  Transition: ["Cut", "Fade", "Dissolve", "Push", "Wipe", "Zoom", "Flash", "Blur"],
  Effect: ["None", "Film grain", "Glow", "Motion blur", "Flash", "Vignette"],
  Speed: ["0.5×", "0.75×", "1×", "1.25×", "1.5×", "2×", "3×"],
  Filters: ["Original", "Golden", "Film", "Noir", "Soft", "Vivid", "Cinematic"],
  Style: ["Editorial", "Cinematic", "Warm", "Clean"],
  "Fit canvas": ["Fill", "Fit"],
  Crop: ["Portrait 9:16", "Square 1:1", "Landscape 16:9", "Original"],
  Border: ["None", "Soft", "Frame", "Rounded"],
  Adjust: ["Brightness", "Contrast", "Saturation", "Warmth"],
  "Speed curve": ["Constant", "Ease in", "Ease out", "Montage", "Bullet time"],
  "Caption style": ["Clean", "Pop", "Karaoke", "Box", "Luxury"],
  Fonts: ["Manrope", "Serif", "Editorial", "Mono"],
  Animation: ["None", "Fade", "Slide up", "Pop", "Typewriter"],
  Fade: ["In", "Out", "In + out"],
  Volume: ["0%", "25%", "50%", "75%", "100%", "150%"],
};

function normalizeClip(value: Record<string, unknown>, index: number): ProjectClip {
  const sourceDuration = Math.max(0.5, Number(value.sourceDuration ?? value.duration ?? 5) / (Number(value.duration) > 180 ? 1000 : 1));
  const kind = value.kind === "image" || value.type === "image" ? "image" : "video";
  return makeClip({ uri: String(value.uri || ""), name: String(value.name || `Shot ${index + 1}`), kind, duration: sourceDuration }, String(value.id || `clip-${index + 1}`));
}

function Player({ clip, playing }: { clip?: ProjectClip; playing: boolean }) {
  const player = useVideoPlayer(clip?.kind === "video" ? clip.uri : null, (p) => { p.loop = true; });
  useEffect(() => { if (clip?.kind === "video") void player.replace(clip.uri); else player.pause(); }, [clip?.id, clip?.uri, clip?.kind, player]);
  useEffect(() => { if (playing && clip?.kind === "video") player.play(); else player.pause(); }, [playing, clip?.id, clip?.kind, player]);
  const stage = "aspect-[9/16] max-h-[42vh] w-[58%] overflow-hidden rounded-2xl border border-[#514831] bg-[#1d1b16]";
  if (clip?.kind === "image") return <View className={stage}><Image source={{ uri: clip.uri }} resizeMode={clip.fit} className="h-full w-full"/></View>;
  if (!clip) return <View className={`${stage} items-center justify-center`}><View className="h-14 w-14 items-center justify-center rounded-full border border-accent/40 bg-black/30"><CirclePlay size={30} color={colors.accent}/></View><Text className="mt-3 text-xs text-muted">Add a moment to preview</Text></View>;
  return <View className={stage}><VideoView player={player} contentFit={clip.fit} nativeControls style={{ flex: 1 }}/></View>;
}

export default function EditorScreen() {
  const params = useLocalSearchParams<{ id: string; projectId?: string; media?: string; kind?: string }>();
  const initial = useMemo<ProjectClip[]>(() => { try { return (JSON.parse(params.media || "[]") as Record<string, unknown>[]).map(normalizeClip); } catch { return []; } }, [params.media]);
  const projectId = String(params.projectId || params.id);
  const initialKind = ["music", "talking", "photo", "copy", "story"].includes(params.kind || "") ? params.kind as ReelProject["kind"] : "music";
  const [clips, setClips] = useState<ProjectClip[]>(initial), [title, setTitle] = useState("Untitled Reel"), [kind, setKind] = useState<ReelProject["kind"]>(initialKind);
  const [audioUri, setAudioUri] = useState<string>(), [audioName, setAudioName] = useState<string>();
  const [overlays, setOverlays] = useState<{ id: string; text: string; start: number; end: number; color: string; size: number }[]>([]);
  const [selected, setSelected] = useState(0), [active, setActive] = useState<TimelineTool>("Media"), [sheet, setSheet] = useState(false), [tab, setTab] = useState("Clip tools"), [playing, setPlaying] = useState(false), [busy, setBusy] = useState(false), [textDraft, setTextDraft] = useState("");
  const undo = useRef<ProjectClip[][]>([]), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width } = useWindowDimensions(), landscape = width > 760;
  const duration = projectDuration(clips), current = groups.find((g) => g.name === active) || groups[0], clip = clips[selected];

  useEffect(() => { let live = true; void getProject(projectId).then((p) => { if (!live || !p) return; setClips(p.clips); setTitle(p.title); setKind(p.kind); setAudioUri(p.audioUri); setAudioName(p.audioName); setOverlays(p.overlays); }); return () => { live = false; }; }, [projectId]);
  useEffect(() => {
    if (!clips.length) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void (async () => {
      const old = await getProject(projectId);
      const p: MobileProject = { id: projectId, title, kind, clips, audioUri, audioName, overlays, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), status: "draft" };
      await saveProject(p).catch((e) => console.warn("Draft save failed", e));
    })(); }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [projectId, clips, title, kind, audioUri, audioName, overlays]);

  function commit(next: ProjectClip[]) { undo.current.push(clips); if (undo.current.length > 30) undo.current.shift(); setClips(next); setSelected((i) => Math.min(i, Math.max(0, next.length - 1))); }
  function updateSelected(patch: Partial<ProjectClip>) { if (!clip) return; commit(clips.map((c, i) => i === selected ? { ...c, ...patch } : c)); }
  function openTool(name: TimelineTool) { setActive(name); setTab("Clip tools"); setSheet(true); }
  function chooseAction(name: string) { setTab(name); }
  function restore() { const previous = undo.current.pop(); if (previous) setClips(previous); }
  function split() { if (!clip) return; const result = splitClip(clip, `${clip.id}-split-${Date.now()}`); if (!result) { Alert.alert("Shot is too short", "Keep at least a small moment on each side of the split."); return; } commit(clips.flatMap((x, i) => i === selected ? result : [x])); setSelected(selected + 1); }
  function duplicate() { if (!clip) return; const copy = { ...clip, id: `${clip.id}-copy-${Date.now()}` }; commit([...clips.slice(0, selected + 1), copy, ...clips.slice(selected + 1)]); setSelected(selected + 1); }
  function removeClip() { if (!clip) return; if (clips.length === 1) { Alert.alert("Keep one shot", "A Reel needs at least one shot."); return; } commit(clips.filter((_, i) => i !== selected)); setSelected(Math.max(0, selected - 1)); }
  async function addMedia(replace = false) {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos", "images"], allowsMultipleSelection: !replace, selectionLimit: 12, quality: 0.8, videoMaxDuration: 180 });
    if (result.canceled || !result.assets.length) return;
    setBusy(true);
    try { const next = await keepPickedAssets(projectId, result.assets); commit(replace && clip ? [...clips.slice(0, selected), { ...next[0], id: clip.id }, ...clips.slice(selected + 1)] : [...clips, ...next]); }
    catch (e) { Alert.alert("Couldn't add your clips", e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function chooseMusic() {
    const result = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    setBusy(true); try { const item = result.assets[0], saved = await keepPickedFile(projectId, item.uri, item.name); setAudioUri(saved); setAudioName(item.name); }
    catch (e) { Alert.alert("Couldn't add soundtrack", e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); }
  }
  function applyOption(option: string) {
    if (active === "Media") {
      if (option === "Add clips") void addMedia();
      else if (option === "Replace shot") void addMedia(true);
      else if (option === "Remove") removeClip();
      else if (option === "Reorder" && clips.length > 1) { const next = [...clips]; const item = next.splice(selected, 1)[0]; next.splice((selected + 1) % (clips.length), 0, item); commit(next); }
    } else if (active === "Shots") {
      if (option === "Previous shot") setSelected(Math.max(0, selected - 1));
      else if (option === "Next shot") setSelected(Math.min(clips.length - 1, selected + 1));
      else if (option === "Add shot") void addMedia();
    } else if (active === "Music") {
      if (option === "Choose music") void chooseMusic();
      else if (option === "Remove music") { setAudioUri(undefined); setAudioName(undefined); }
      else if (option === "Mute clip audio" && clip) updateSelected({ muted: !clip.muted });
      else if (option === "Volume") updateSelected({ volume: clip ? clip.volume >= 1.5 ? 0.5 : clip.volume + 0.5 : 1 });
    } else if (active === "Text" || active === "Captions" || active === "Stickers") {
      const text = textDraft.trim() || (option === "Emoji" ? "✨" : "Your story");
      if (option.startsWith("Remove") && overlays.length) setOverlays(overlays.slice(0, -1));
      else if (option.startsWith("Add") || option === "Emoji" || option === "Add captions") { setOverlays([...overlays, { id: `overlay-${Date.now()}`, text, start: 0, end: Math.max(1, duration), color: "#FFFFFF", size: 36 }]); setTextDraft(""); }
    } else if (active === "Filters") updateSelected({ filter: option });
    else if (active === "Style") updateSelected({ filter: option === "Warm" ? "Golden" : option === "Clean" ? "Original" : option });
    else if (active === "Background") updateSelected({ fit: option === "Fit canvas" || option === "Blur" ? "contain" : "cover" });
    else if (active === "Motion") {
      if (option === "Stabilize") Alert.alert("Stabilize shot", "Stabilization will be applied during native export.");
      else if (option === "Keyframes") Alert.alert("Keyframes", "Select a point on the timeline to set a motion keyframe.");
      else updateSelected({ speed: clip ? (clip.speed >= 2 ? 1 : clip.speed + 0.5) : 1 });
    } else if (active === "Voice") Alert.alert(option, "Voice recording and synthesis will be connected to the native audio track in the next editor pass.");
    else if (active === "Layers") Alert.alert(option, "Layer editing is available through the track lanes; choose a text or media track to edit.");
    setTab(option);
  }
  function doAction(action: ClipAction) {
    if (!clip) return;
    switch (action) {
      case "Split": split(); break;
      case "Duplicate": duplicate(); break;
      case "Delete": removeClip(); break;
      case "Reset": updateSelected({ speed: 1, reverse: false, muted: false, volume: 1, filter: "Original", transition: "Cut", rotation: 0, mirror: false, flip: false, fit: "cover" }); break;
      case "Reverse": updateSelected({ reverse: !clip.reverse }); break;
      case "Rotate": updateSelected({ rotation: (clip.rotation + 90) % 360 }); break;
      case "Mirror": updateSelected({ mirror: !clip.mirror }); break;
      case "Flip": updateSelected({ flip: !clip.flip }); break;
      case "Speed": updateSelected({ speed: clip.speed >= 2 ? 0.5 : clip.speed + 0.5 }); break;
      case "Volume": updateSelected({ muted: !clip.muted }); break;
      case "Fit canvas": updateSelected({ fit: clip.fit === "cover" ? "contain" : "cover" }); break;
      case "Freeze": updateSelected({ speed: 0.25 }); break;
      case "Transition": setTab("Transition"); break;
      case "Trim": setTab("Trim"); break;
      case "Crop": setTab("Crop"); break;
      case "Extract audio": Alert.alert("Extract audio", "The clip's soundtrack will be added when the renderer is connected."); break;
      default: setTab(action);
    }
    if (!["Transition", "Trim", "Crop"].includes(action)) setTab(action);
  }
  async function saveNow() { setBusy(true); try { const old = await getProject(projectId); await saveProject({ id: projectId, title, kind, clips, audioUri, audioName, overlays, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), status: "draft" }); Alert.alert("Draft saved", "Your Reel is saved on this device."); } catch (e) { Alert.alert("Couldn't save draft", e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); } }
  async function exportNow() {
    if (!clips.length) return Alert.alert("Add a shot", "Choose a video or photo before exporting.");
    const drafts = await listProjects();
    const saved = drafts.find((p) => p.id === projectId);
    Alert.alert("Ready to export", saved ? "Your edit is safely saved on this device. The Android export engine will render the final MP4 here." : "Save your Reel before exporting.");
  }

  return <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
    <View className="flex-row items-center gap-3 border-b border-border px-4 py-3"><Pressable onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-xl bg-surface"><X size={18} color={colors.foreground}/></Pressable><View className="flex-1"><Text className="text-[10px] font-bold uppercase tracking-[1.7px] text-accent">SHUBIX STUDIO</Text><Text className="mt-0.5 text-sm font-semibold text-foreground">{title} <ChevronDown size={12} color={colors.muted}/></Text></View><Pressable onPress={() => void exportNow()} className="rounded-xl bg-accent px-4 py-2.5"><Text className="text-xs font-bold text-on-accent">Export</Text></Pressable></View>
    <ScrollView className="flex-1" contentContainerClassName="pb-5" showsVerticalScrollIndicator={false}>
      <View className={landscape ? "flex-row items-center justify-center gap-8 px-5 py-5" : "items-center px-5 pt-4"}><Player key={clip?.id || "blank"} clip={clip} playing={playing}/>{landscape && <View className="w-[38%]"><Text className="text-xl font-semibold text-foreground">A story in the making</Text><Text className="mt-2 text-sm leading-6 text-muted">Shape the pace, look, sound, and feeling of every shot.</Text></View>}</View>
      {overlays.length > 0 && <View className="mx-4 mb-3 rounded-xl border border-[#5c4d31] bg-[#28241b] px-3 py-2"><Text numberOfLines={1} className="text-xs font-semibold text-accent">{overlays.at(-1)?.text}</Text></View>}
      <View className="mx-4 mb-3 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2.5"><Text className="text-xs text-muted">00:00.0 <Text className="text-foreground">/ {duration.toFixed(1)} s</Text></Text><View className="flex-row items-center gap-2"><Pressable onPress={() => setPlaying(!playing)} className="h-10 w-10 items-center justify-center rounded-full bg-accent">{playing ? <Pause size={18} color={colors.background}/> : <CirclePlay size={19} color={colors.background}/>}</Pressable><Pressable className="h-9 w-9 items-center justify-center rounded-xl bg-surface-2"><Expand size={16} color={colors.muted}/></Pressable></View></View>
      <View className="mx-4 overflow-hidden rounded-2xl border border-border bg-surface"><View className="flex-row items-center justify-between border-b border-border px-3.5 py-3"><View><Text className="text-sm font-semibold text-foreground">Timeline</Text><Text className="mt-0.5 text-[10px] text-muted">{clips.length} {clips.length === 1 ? "shot" : "shots"} · {duration.toFixed(1)} sec</Text></View><Pressable onPress={() => void addMedia()} className="h-8 w-8 items-center justify-center rounded-lg bg-surface-2"><Plus size={15} color={colors.muted}/></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-3 pb-3 pt-3"><View><View className="mb-1 ml-[58px] h-4 flex-row items-center gap-9">{["00:00", "00:02", "00:04", "00:06", "00:08", "00:10"].map((x) => <Text key={x} className="text-[9px] text-muted">{x}</Text>)}</View>
          <View className="flex-row items-center"><Text className="w-[54px] text-[9px] font-bold uppercase tracking-[1px] text-accent">VIDEO</Text><View className="flex-row gap-1">{clips.map((item, i) => <Pressable key={item.id} onPress={() => setSelected(i)} className={`h-[58px] w-[132px] justify-end overflow-hidden rounded-lg border p-2 ${selected === i ? "border-accent bg-[#493e29]" : "border-border bg-surface-2"}`}><View className="absolute left-2 top-2 h-1 w-10 rounded-full bg-white/20"/><Text numberOfLines={1} className="text-[10px] font-semibold text-foreground">{item.name}</Text><Text className="text-[9px] text-muted">{clipDuration(item).toFixed(1)}s · {item.speed}×</Text></Pressable>)}</View></View>
          <Pressable onPress={() => audioUri ? openTool("Music") : void chooseMusic()} className="mt-2 flex-row items-center"><Text className="w-[54px] text-[9px] font-bold uppercase tracking-[1px] text-[#93ae98]">AUDIO</Text><View className="h-9 min-w-[160px] flex-1 flex-row items-center gap-[3px] overflow-hidden rounded-lg border border-[#435047] bg-[#202720] px-2">{audioUri ? Array.from({ length: 40 }, (_, i) => <View key={i} className="w-[2px] rounded-full bg-[#829980]" style={{ height: 5 + ((i * 17 + i * i * 3) % 17) }}/>) : <Text className="text-[10px] text-muted">+ Add soundtrack</Text>}</View></Pressable>
          <Pressable onPress={() => openTool("Text")} className="mt-2 flex-row items-center"><Text className="w-[54px] text-[9px] font-bold uppercase tracking-[1px] text-[#b39bcc]">TEXT</Text><View className="min-h-7 min-w-[90px] justify-center rounded-md border border-[#665276] bg-[#302638] px-2"><Text className="text-[9px] text-[#d1b5e7]">{overlays.length ? `${overlays.length} overlay${overlays.length === 1 ? "" : "s"}` : "+ Add text"}</Text></View></Pressable>
        </View></ScrollView></View>
      <View className="mx-4 mt-4 flex-row items-center justify-between"><View><Text className="text-sm font-semibold text-foreground">Creative tools</Text><Text className="mt-0.5 text-[10px] text-muted">Choose a tool to refine your Reel</Text></View><Text className="text-[10px] text-accent">{groups.length} tools</Text></View>
      <View className="mx-4 mt-2 flex-row flex-wrap gap-2">{groups.map(({ name, icon: Icon }) => <Pressable onPress={() => openTool(name)} key={name} className={`min-h-[72px] w-[31.5%] items-center justify-center gap-1.5 rounded-xl border ${active === name && sheet ? "border-[#806b40] bg-[#29251d]" : "border-border bg-surface"}`}><Icon size={17} color={active === name && sheet ? colors.accent : colors.muted}/><Text className="text-[10px] font-medium text-foreground">{name}</Text></Pressable>)}</View>
      <View className="mx-4 mt-5 flex-row items-center justify-between"><Text className="text-sm font-semibold text-foreground">Shot {selected + 1} · {clip ? `${clipDuration(clip).toFixed(1)} s` : "—"}</Text><Text className="text-[10px] text-muted">Clip tools</Text></View>
      <ScrollView horizontal className="mt-2" contentContainerClassName="gap-2 px-4" showsHorizontalScrollIndicator={false}>{actions.map((name) => <Pressable key={name} onPress={() => { setActive("Shots"); setSheet(true); if (["Transition", "Effect", "Speed", "Trim", "Crop", "Border", "Adjust", "Speed curve", "Fade"].includes(name)) setTab(name); else doAction(name); }} className="rounded-xl border border-border bg-surface px-3 py-2.5"><Text className="text-[10px] font-medium text-foreground">{name}</Text></Pressable>)}</ScrollView>
      <View className="mx-4 mt-4 flex-row gap-2"><Pressable onPress={restore} disabled={!undo.current.length} className="flex-1 items-center rounded-xl border border-border bg-surface py-3"><Text className="text-xs font-semibold text-muted">Undo</Text></Pressable><Pressable onPress={() => void saveNow()} className="flex-1 items-center rounded-xl border border-border bg-surface py-3"><Text className="text-xs font-semibold text-foreground">{busy ? "Working…" : "Save draft"}</Text></Pressable></View>
    </ScrollView>
    <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}><View className="flex-1 justify-end bg-black/70"><Pressable onPress={() => setSheet(false)} className="flex-1"/><View className="max-h-[80%] rounded-t-[28px] border border-border bg-[#171714] px-4 pb-5 pt-3"><View className="mb-4 items-center"><View className="h-1 w-10 rounded-full bg-[#565247]"/></View><View className="mb-3 flex-row items-center justify-between"><View><Text className="text-[10px] font-bold uppercase tracking-[1.6px] text-accent">{active} · {tab}</Text><Text className="mt-1 text-lg font-semibold text-foreground">Make it yours</Text></View><Pressable onPress={() => setSheet(false)} className="h-9 w-9 items-center justify-center rounded-full bg-surface-2"><X size={17} color={colors.foreground}/></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-2">{["Clip tools", ...current.options].map((x) => <Pressable key={x} onPress={() => chooseAction(x)} className={`rounded-full border px-3.5 py-2 ${tab === x ? "border-[#806b40] bg-[#2b271e]" : "border-border bg-surface"}`}><Text className={`text-xs font-medium ${tab === x ? "text-accent" : "text-muted"}`}>{x}</Text></Pressable>)}</ScrollView>
        {active === "Text" && <TextInput value={textDraft} onChangeText={setTextDraft} placeholder="Type your on-screen text" placeholderTextColor={colors.muted} className="mt-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-foreground"/>}
        {tab === "Trim" && clip && <View className="mt-3 flex-row items-center justify-between"><Pressable onPress={() => updateSelected({ start: Math.min(clip.end - 0.25, clip.start + 0.25) })} className="rounded-xl border border-border bg-surface px-4 py-2.5"><Text className="text-xs text-foreground">Trim start +0.25s</Text></Pressable><Text className="text-xs text-muted">{clip.start.toFixed(1)} — {clip.end.toFixed(1)}</Text><Pressable onPress={() => updateSelected({ end: Math.max(clip.start + 0.25, clip.end - 0.25) })} className="rounded-xl border border-border bg-surface px-4 py-2.5"><Text className="text-xs text-foreground">Trim end −0.25s</Text></Pressable></View>}
        {tab === "Crop" && <View className="mt-3 flex-row flex-wrap gap-2">{["Portrait 9:16", "Square 1:1", "Landscape 16:9", "Original"].map((x) => <Pressable onPress={() => { updateSelected({ fit: x === "Original" ? "contain" : "cover" }); setTab(x); }} key={x} className="rounded-xl border border-border bg-surface px-3 py-2"><Text className="text-xs text-foreground">{x}</Text></Pressable>)}</View>}
        <Text className="mb-3 mt-3 text-xs text-muted">{tab === "Clip tools" ? "Refine the selected shot." : `Choose a ${tab.toLowerCase()} option.`}</Text>
        <ScrollView className="max-h-[37vh]" contentContainerClassName="flex-row flex-wrap gap-2 pb-3">{(tab === "Clip tools" ? actions : choices[tab as ClipAction | TimelineTool] || current.options).map((name) => <Pressable key={name} onPress={() => {
          if (active === "Shots" && actions.includes(name as ClipAction)) doAction(name as ClipAction);
          else if (name === "Choose music") void chooseMusic();
          else if (name === "Add clips" || name === "Add shot") void addMedia();
          else if (name === "Replace shot") void addMedia(true);
          else if (name === "Remove music") { setAudioUri(undefined); setAudioName(undefined); }
          else if (name === "Reverse") doAction("Reverse");
          else if (name === "Speed") doAction("Speed");
          else if (tab === "Clip tools") doAction(name as ClipAction);
          else applyOption(name);
        }} className={`min-h-10 rounded-xl border px-3.5 py-2.5 ${tab === name ? "border-[#806b40] bg-[#29251d]" : "border-border bg-surface"}`}><Text className="text-xs font-medium text-foreground">{name}</Text></Pressable>)}</ScrollView>
        <Pressable onPress={() => setSheet(false)} className="items-center rounded-2xl bg-accent py-3.5"><Text className="text-sm font-bold text-on-accent">Done</Text></Pressable></View></View></Modal>
  </SafeAreaView>;
}
