import { useEffect, useState } from "react";
import { BackHandler, Platform, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useStudioText } from "@shubix/hooks";
import { askAction, Button, tasks, toast } from "@shubix/ui-mobile";
import { usePlanAi } from "../../lib/data";
import { PlanGate } from "../../components/templates/PlanGate";
import type { ProjectClip } from "@shubix/validations";
import { engine, engineOn, shotsOf, type SongAnalysis } from "../../lib/engine";
import { errorMessage } from "@shubix/api-client";
import { keepPickedAssets, keepPickedFile, saveProject } from "../../lib/projects";
import { pickSong, recentSongs, songLength, type Song } from "../../lib/songs";
import { AskShubix, styleFromWords } from "../../components/organisms/AskShubix";
import { pickInOrder } from "../../components/organisms/Gallery";
import { AI_STEPS, FlowAdjust, FlowAnalyse, FlowChoose, FlowClips, FlowHead, FlowIntro, KINDS, ORDER, type ClipSettings, type FlowKind, type FlowStep } from "../../components/organisms/CreateFlow";

/** Create (the website's /create/music, /talking, /photo, /copy on a phone): the flow's screens one at a time, with
 * Next at the bottom, off (and saying what it waits for) until the screen is done. At the end the clips and the song
 * are kept on the phone as a draft and the editor opens. Story Maker: the Music Reel flow for now. */
export default function CreateScreen() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  // Copy a Reel and Story Maker open on their plan (the website's /create/copy, /create/story)
  return <PlanGate href={`/create/${kind}`}><CreateFlowScreen /></PlanGate>;
}
function CreateFlowScreen() {
  const params = useLocalSearchParams<{ kind: string; templateId?: string }>();
  const kind: FlowKind = (["music", "talking", "photo", "copy"] as const).find((k) => k === params.kind) ?? "music";
  const words = useStudioText(), insets = useSafeAreaInsets(), queryClient = useQueryClient(), order = ORDER[kind];
  const planAi = usePlanAi();
  const [step, setStep] = useState<FlowStep>("intro");
  const [music, setMusic] = useState<SongAnalysis | null>(null), [song, setSong] = useState<Song | null>(null), [recent, setRecent] = useState<Song[]>([]), [reading, setReading] = useState(false);
  const [length, setLength] = useState(0), [start, setStart] = useState(0), [photos, setPhotos] = useState(kind === "photo"), [media, setMedia] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [settings, setSettings] = useState<ClipSettings>({ order: "order", aspect: "9:16", pace: "natural", under: "0.09" });
  const [progress, setProgress] = useState({ pct: 0, done: 0, status: "" }), [wish, setWish] = useState("");
  useEffect(() => { void recentSongs().then(setRecent); }, []);

  const go = (to: FlowStep | undefined) => to && setStep(to);
  const back = () => { const i = order.indexOf(step); if (i <= 0) router.back(); else if (step !== "analyse") go(order[i - 1]); };
  useEffect(() => { if (Platform.OS === "web") return; const h = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; }); return () => h.remove(); }); // Android back: the screen before

  async function choose(pick: () => Promise<Song | null>) {
    setReading(true);
    try { const s = await pick(); if (s) { setSong(s); await hear(s); setRecent(await recentSongs()); } } catch (e) { toast(errorMessage(e), "danger"); } finally { setReading(false); }
  }
  async function pickRecent(s: Song) {
    setReading(true); setSong(s.duration ? s : { ...s, duration: await songLength(s.uri) }); await hear(s); setReading(false);
  }
  // the song as the website's engine hears it (its beats, drops and breaks, checked by Shubix: the Reel is cut on them); its cards show the way
  async function hear(s: Song) {
    setMusic(null); setStart(0);
    if (!engineOn) return toast(words("The song's beats and the Reel's edit are made by the Shubix app: Expo Go cannot run them."), "info");
    try { setMusic(await engine.song(s.uri, s.name)); } catch (e) { toast(errorMessage(e), "danger"); }
  }
  // the Reel's length: the website's engine places the part on the song's best part (without it, from the start)
  async function lengthTo(n: number) {
    setLength(n);
    if (!engineOn || !music) return setStart((t) => (n ? Math.max(0, Math.min(t, (music?.duration ?? song?.duration ?? n) - n)) : 0));
    try { setStart((await engine.choose({ length: n })).start); } catch (e) { toast(errorMessage(e), "danger"); }
  }
  // the part dragged on the waves
  async function partFrom(t: number) {
    setStart(t);
    if (engineOn && music) try { setStart((await engine.part(t)).start); } catch (e) { toast(errorMessage(e), "danger"); }
  }
  async function addMedia() {
    const got = await pickInOrder({ kind: photos ? "image" : "video", limit: Math.max(1, 30 - media.length) }); // in the order tapped ("In my order")
    if (got) setMedia((old) => [...old, ...got].slice(0, 30));
  }
  // Analysing: the clips and the song kept on the phone, the Reel made by the website's engine (its shots on the beats,
  // their transitions and effects), the draft saved, then the editor. Without the engine (Expo Go) the clips play in turn.
  async function make() {
    setStep("analyse");
    const id = `draft-${Date.now()}`, at = (pct: number, done: number) => setProgress({ pct, done, status: words(AI_STEPS[Math.min(done, 3)][1]) });
    try {
      at(0.02, 0); setProgress((p) => ({ ...p, status: words("Reading your clips…") }));
      const style = styleFromWords(wish), speed = { fast: 1.25, smooth: 0.8, "": 1 }[style];
      tasks.start("keep", "clips", words("Adding your clips"), `${words("Clip")} 1 / ${media.length}`);
      let clips = await keepPickedAssets(id, media, (n) => { setProgress((p) => ({ ...p, pct: 0.02 + (0.3 * n) / media.length })); tasks.update("keep", n / media.length, `${words("Clip")} ${Math.min(media.length, n + 1)} / ${media.length}`); });
      tasks.clear("keep");
      at(0.35, 1);
      const audioUri = song ? await keepPickedFile(id, song.uri, `${song.name}.m4a`) : undefined;
      let studio = false;
      if (engineOn && music) {
        await engine.choose({ order: settings.order, aspect: settings.aspect, mode: style || "auto" }); // (the length and the part are set already)
        // each clip numbered (phones name many clips the same): the ones the studio kept, in its order
        const kept = (await engine.clips(clips.map((c, i) => ({ uri: c.uri, name: `${i + 1}-${c.name}` })))).names;
        at(0.7, 2);
        const sources = kept.map((n) => clips[parseInt(n, 10) - 1]).filter((c): c is ProjectClip => !!c);
        clips = shotsOf((await engine.ready(id)).state.edit, sources.length ? sources : clips); studio = true;
      } else clips = clips.map((c) => ({ ...c, speed }));
      at(0.92, 3);
      const now = new Date().toISOString();
      await saveProject({ id, title: words(KINDS[kind].title), kind, clips, audioUri, audioName: song?.name, overlays: [], ...(music ? { music } : {}), studio, createdAt: now, updatedAt: now, status: "draft",
        ...(params.templateId ? { templateId: params.templateId } : {}), settings: { start, length, ...settings, ...(wish ? { wish } : {}) } });
      await queryClient.invalidateQueries({ queryKey: ["drafts"] });
      setProgress({ pct: 1, done: 4, status: words("Your Reel is ready!") });
      setTimeout(() => { setStep("clips"); router.push({ pathname: "/editor", params: { id } }); }, 450); // back from the editor: the clips again
    } catch (e) { tasks.clear("keep"); toast(errorMessage(e), "danger"); setStep("clips"); }
  }

  // Free (no Shubix AI in the plan): before the Reel is made, what Shubix AI would do and the way to it (the website's upsell)
  async function upsell() {
    if (planAi !== false) return make();
    const v = await askAction({ title: words("Make it perfect with Shubix AI"), body: `${words("Your Reel is ready. With the Editor or Pro plan, Shubix AI edits it like a pro")}:`,
      list: ["The best moments of every clip, picked for you", "Trendy transitions and effects, right on the beat", "Ask Shubix: change anything in your own words", "Captions and pro colour, automatically"].map((x) => words(x)),
      ok: words("Upgrade to Shubix AI"), cancel: words("Create basic Reel") });
    if (v === 0) router.push({ pathname: "/pricing", params: { feature: "ai" } });
    else if (v === 1) void make();
  }

  // the bottom button: its words say what it waits for while it is off (the website's flow.ts)
  const needSong = kind !== "talking";
  const button = {
    intro: { title: words(kind === "copy" ? "Pick the Reel to copy" : "Let's Start"), on: true, press: () => go(order[1]) },
    choose: { title: words(reading ? "Reading your song…" : !song ? "Choose a song to continue" : "Next"), on: !!song && !reading, press: () => go("adjust") },
    adjust: { title: words(reading ? "Reading your song…" : !song ? "Choose a song to continue" : "Next"), on: !!song && !reading, press: () => go("clips") },
    clips: { title: words(!media.length ? (photos ? "Add your photos to continue" : "Add your clips to continue") : needSong && !song ? "Choose a song first" : "Next"), on: !!media.length && (!needSong || !!song), press: () => void upsell() },
    analyse: null,
  }[step];
  const title = { intro: "", choose: kind === "copy" ? words("Music") : words("Choose Music"), adjust: words("Adjust Music"), clips: words(photos ? "Add Your Photos" : "Add Your Clips"), analyse: "" }[step];
  return (
    <View className="flex-1 bg-background">
      <FlowHead title={title} at={{ intro: 1, choose: 1, adjust: 1, clips: 2, analyse: 3 }[step]} onBack={back} onSkip={step === "intro" ? () => go(order[1]) : undefined} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-6 pt-2" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step !== "intro" && step !== "analyse" && <View className="mb-4"><AskShubix onAsk={(t) => { setWish((w) => `${w} · ${t}`.replace(/^ · /, "").slice(-800)); return words("Got it! I'll edit your Reel this way as soon as it is made."); }} /></View>}
        {step === "intro" && <FlowIntro kind={kind} />}
        {step === "choose" && <FlowChoose kind={kind} song={song} recent={recent} busy={reading} onPick={() => void choose(() => pickSong())} onPickReel={() => void choose(() => pickSong("video"))} onRecent={(s) => void pickRecent(s)} onForget={(uri) => { setRecent((r) => r.filter((s) => s.uri !== uri)); if (song?.uri === uri) setSong(null); }} />}
        {step === "adjust" && song && <FlowAdjust song={song} music={music} length={length} start={start} onLength={(n) => void lengthTo(n)} onStart={(t) => void partFrom(t)} />}
        {step === "clips" && <FlowClips kind={kind} photos={photos} onTab={(p) => { setPhotos(p); setMedia([]); }} media={media} onAdd={() => void addMedia()} onRemove={(i) => setMedia((m) => m.filter((_, j) => j !== i))} onReverse={() => setMedia((m) => [...m].reverse())} onEarlier={(i) => setMedia((m) => i > 0 ? [...m.slice(0, i - 1), m[i], m[i - 1], ...m.slice(i + 1)] : m)} settings={settings} onSettings={(s) => setSettings((o) => ({ ...o, ...s }))} />}
        {step === "analyse" && <FlowAnalyse {...progress} />}
      </ScrollView>
      {button && <View className="px-4 pt-2" style={{ paddingBottom: 14 + insets.bottom }}><Button full size="xl" title={button.title} iconAfter={button.on ? "arrow" : undefined} disabled={!button.on} onPress={button.press} /></View>}
    </View>
  );
}
