import { useEffect, useState } from "react";
import { BackHandler, Platform, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useStudioText } from "@shubix/hooks";
import { askAction, Button, toast } from "@shubix/ui-mobile";
import { usePlanAi } from "../../lib/data";
import { errorMessage } from "@shubix/api-client";
import { keepPickedAssets, keepPickedFile, saveProject } from "../../lib/projects";
import { pickSong, recentSongs, songLength, type Song } from "../../lib/songs";
import { AskShubix, styleFromWords } from "../../components/organisms/AskShubix";
import { AI_STEPS, FlowAdjust, FlowAnalyse, FlowChoose, FlowClips, FlowHead, FlowIntro, KINDS, ORDER, type ClipSettings, type FlowKind, type FlowStep } from "../../components/organisms/CreateFlow";

/** Create (the website's /create/music, /talking, /photo, /copy on a phone): the flow's screens one at a time, with
 * Next at the bottom, off (and saying what it waits for) until the screen is done. At the end the clips and the song
 * are kept on the phone as a draft and the editor opens. Story Maker: the Music Reel flow for now. */
export default function CreateScreen() {
  const params = useLocalSearchParams<{ kind: string; templateId?: string }>();
  const kind: FlowKind = (["music", "talking", "photo", "copy"] as const).find((k) => k === params.kind) ?? "music";
  const words = useStudioText(), insets = useSafeAreaInsets(), queryClient = useQueryClient(), order = ORDER[kind];
  const planAi = usePlanAi();
  const [step, setStep] = useState<FlowStep>("intro");
  const [song, setSong] = useState<Song | null>(null), [recent, setRecent] = useState<Song[]>([]), [reading, setReading] = useState(false);
  const [length, setLength] = useState(0), [photos, setPhotos] = useState(kind === "photo"), [media, setMedia] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [settings, setSettings] = useState<ClipSettings>({ order: "order", aspect: "9:16", pace: "natural", under: "0.09" });
  const [progress, setProgress] = useState({ pct: 0, done: 0, status: "" }), [wish, setWish] = useState("");
  useEffect(() => { void recentSongs().then(setRecent); }, []);

  const go = (to: FlowStep | undefined) => to && setStep(to);
  const back = () => { const i = order.indexOf(step); if (i <= 0) router.back(); else if (step !== "analyse") go(order[i - 1]); };
  useEffect(() => { if (Platform.OS === "web") return; const h = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; }); return () => h.remove(); }); // Android back: the screen before

  async function choose(pick: () => Promise<Song | null>) {
    setReading(true);
    try { const s = await pick(); if (s) { setSong(s); setRecent(await recentSongs()); } } catch (e) { toast(errorMessage(e), "danger"); } finally { setReading(false); }
  }
  async function pickRecent(s: Song) {
    if (s.duration) return setSong(s);
    setReading(true); setSong({ ...s, duration: await songLength(s.uri) }); setReading(false);
  }
  async function addMedia() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: photos ? ["images"] : ["videos"], allowsMultipleSelection: true, selectionLimit: Math.max(1, 30 - media.length), quality: 0.9 });
    if (!r.canceled) setMedia((old) => [...old, ...r.assets].slice(0, 30));
  }
  // Analysing: the clips and the song kept on the phone, the draft saved, then the editor
  async function make() {
    setStep("analyse");
    const id = `draft-${Date.now()}`, at = (pct: number, done: number) => setProgress({ pct, done, status: words(AI_STEPS[Math.min(done, 3)][1]) });
    try {
      at(0.02, 0); setProgress((p) => ({ ...p, status: words("Reading your clips…") }));
      const speed = { fast: 1.25, smooth: 0.8, "": 1 }[styleFromWords(wish)]; // what was asked of Shubix AI, as the phone can do it
      const clips = (await keepPickedAssets(id, media, (n) => setProgress((p) => ({ ...p, pct: 0.02 + (0.58 * n) / media.length })))).map((c) => ({ ...c, speed }));
      at(0.62, 1);
      const audioUri = song ? await keepPickedFile(id, song.uri, `${song.name}.m4a`) : undefined;
      at(0.8, 2);
      const now = new Date().toISOString();
      await saveProject({ id, title: words(KINDS[kind].title), kind, clips, audioUri, audioName: song?.name, overlays: [], createdAt: now, updatedAt: now, status: "draft",
        ...(params.templateId ? { templateId: params.templateId } : {}), settings: { length, ...settings, ...(wish ? { wish } : {}) } });
      at(0.92, 3);
      await queryClient.invalidateQueries({ queryKey: ["drafts"] });
      setProgress({ pct: 1, done: 4, status: words("Your Reel is ready!") });
      setTimeout(() => { setStep("clips"); router.push({ pathname: "/editor", params: { id } }); }, 450); // back from the editor: the clips again
    } catch (e) { toast(errorMessage(e), "danger"); setStep("clips"); }
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
        {step === "adjust" && song && <FlowAdjust song={song} length={length} onLength={setLength} />}
        {step === "clips" && <FlowClips kind={kind} photos={photos} onTab={(p) => { setPhotos(p); setMedia([]); }} media={media} onAdd={() => void addMedia()} onRemove={(i) => setMedia((m) => m.filter((_, j) => j !== i))} settings={settings} onSettings={(s) => setSettings((o) => ({ ...o, ...s }))} />}
        {step === "analyse" && <FlowAnalyse {...progress} />}
      </ScrollView>
      {button && <View className="px-4 pt-2" style={{ paddingBottom: 14 + insets.bottom }}><Button full size="xl" title={button.title} iconAfter={button.on ? "arrow" : undefined} disabled={!button.on} onPress={button.press} /></View>}
    </View>
  );
}
