import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, Platform, ScrollView, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useStudioText } from "@mobile/hooks";
import { Button, askAction, confirmAction, tasks, tell } from "@mobile/ui-mobile";
import { PlanGate } from "../../components/templates/PlanGate";
import type { ProjectClip } from "@mobile/validations";
import { engine, engineOn, shotsOf, type SongAnalysis } from "../../lib/engine";
import { errorMessage } from "@mobile/api-client";
import { forgetKeptFiles, keepPickedAssets, keepPickedFile, removeProject, saveProject, takeNewReelSeed } from "../../lib/projects";
import { pickSong, recentSongs, songLength, type Song } from "../../lib/songs";
import { AskShubix, styleFromWords } from "../../components/organisms/AskShubix";
import { pickInOrder } from "../../components/organisms/Gallery";
import { FlowAdjust, FlowChoose, FlowClips, FlowHead, FlowIntro, KINDS, ORDER, type ClipSettings, type FlowKind, type FlowStep } from "../../components/organisms/CreateFlow";

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
  const [step, setStep] = useState<FlowStep>("intro");
  const [music, setMusic] = useState<SongAnalysis | null>(null), [song, setSong] = useState<Song | null>(null), [recent, setRecent] = useState<Song[]>([]), [reading, setReading] = useState(false);
  const [length, setLength] = useState(0), [start, setStart] = useState(0), [photos, setPhotos] = useState(kind === "photo"), [media, setMedia] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [settings, setSettings] = useState<ClipSettings>({ order: "order", aspect: "9:16", pace: "natural", under: "0.09" });
  const [wish, setWish] = useState(""), [working, setWorking] = useState(false), [focused, setFocused] = useState(true);
  useEffect(() => { void recentSongs().then(setRecent); }, []);

  const go = (to: FlowStep | undefined) => to && setStep(to);
  const styleNow = () => styleFromWords(wish);
  // leaving the screen: the studio drops everything (no AI keeps working), so what it held is read again
  const making = useRef(false), stage = useRef<"song" | "clips" | "ai">("song"), askAgain = useRef(false), songStopped = useRef(false), madeReel = useRef<{ id: string; sig: string; media: ImagePicker.ImagePickerAsset[]; song: Song | null; start: number; length: number; kept: { uris: string[]; clips: ProjectClip[] } } | null>(null), kept = useRef<{ uris: string[]; clips: ProjectClip[] }>({ uris: [], clips: [] }), fresh = useRef(false), heard = useRef("");
  const read = useRef<{ key: string; clips: ProjectClip[]; sources: ProjectClip[] } | null>(null), draft = useRef(`draft-${Date.now()}`);
  const stop = () => { making.current = false; tasks.clear("flow"); read.current = null; heard.current = ""; fresh.current = true; engine.stop(); };
  // the popup's Cancel: the studio stops what is running, what is done stays done, and Next goes on from there
  const cancelWork = () => {
    making.current = false; tasks.clear("flow"); void engine.cancel().catch(() => undefined); setReading(false); tasks.unlock();
    if (stage.current === "song") songStopped.current = true;
    if (stage.current === "clips") askAgain.current = true;
    if (stage.current === "ai") setStep("clips");
  };
  // Cancel Reel: nothing of it stays, back to Home
  async function cancelReel() {
    if (!(await confirmAction({ title: words("Cancel this Reel?"), body: words("Your song, clips and progress for this Reel will be removed."), ok: words("Cancel Reel"), cancel: words("Keep working"), danger: true }))) return;
    stop(); forgetKeptFiles(draft.current); router.replace("/");
  }
  const act = useRef({ cancelWork, cancelReel }); act.current = { cancelWork, cancelReel };
  useFocusEffect(useCallback(() => {
    setFocused(true); tasks.guard({ onCancel: () => act.current.cancelWork(), onCancelReel: () => void act.current.cancelReel() });
    return () => { setFocused(false); tasks.guard(null); if (making.current) stop(); };
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => { const i = order.indexOf(step); if (i <= 0) router.back(); else go(order[i - 1]); };
  useEffect(() => { if (Platform.OS === "web") return; const h = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; }); return () => h.remove(); }); // Android back: the screen before
  // Next while its work was cancelled: the work again, or not; true on Proceed
  const notDone = async (body: string) => {
    const v = await askAction({ title: words("Analysis not done"), body, ok: words("Proceed"), cancel: words("Cancel"), extra: words("Cancel Reel") });
    if (v === 2) void cancelReel();
    return v === 0;
  };

  async function choose(pick: () => Promise<Song | null>) {
    setReading(true);
    try { const s = await pick(); if (s) { setSong(s); await hear(s); setRecent(await recentSongs()); } } catch (e) { tell(errorMessage(e), "danger"); } finally { setReading(false); }
  }
  async function pickRecent(s: Song) {
    setReading(true); setSong(s.duration ? s : { ...s, duration: await songLength(s.uri) }); await hear(s); setReading(false);
  }
  // once for this Reel, at its first use of the studio (not on opening this screen: leaving without making a Reel keeps
  // the last Reel's session; a second song for this same Reel does not start it again)
  const startFresh = () => { if (!fresh.current) { fresh.current = true; engine.fresh(); } };
  // the song as the website's engine hears it (its beats, drops and breaks, checked by Shubix: the Reel is cut on them); the popup shows the way
  async function hear(s: Song) {
    setMusic(null); setStart(0); songStopped.current = false;
    if (!engineOn) { tell(words("The song's beats and the Reel's edit are made by the Shubix app: Expo Go cannot run them."), "info"); return false; }
    startFresh(); stage.current = "song"; making.current = true; tasks.start("flow", "music", words("Adding your song"), s.name);
    try { setMusic(await engine.song(s.uri, s.name)); heard.current = s.uri; return true; }
    catch (e) { if (making.current) tell(errorMessage(e), "danger"); return false; }
    finally { making.current = false; tasks.clear("flow"); }
  }
  // Next on the song's screens: its analysis must be done
  async function songThen(next: FlowStep | undefined) {
    if ((music && !songStopped.current) || !engineOn) return go(next);
    if (song && (await notDone(words("Your song's beat check did not finish."))) && (await songAgain(song))) go(next);
  }
  // Proceed after a Cancel: the song goes on from where it stopped
  async function songAgain(s: Song) {
    stage.current = "song"; making.current = true; tasks.start("flow", "music", words("Adding your song"), s.name);
    try { setMusic(await engine.songAgain()); songStopped.current = false; heard.current = s.uri; return true; }
    catch (e) { if (making.current) tell(errorMessage(e), "danger"); return false; }
    finally { making.current = false; tasks.clear("flow"); }
  }
  // the Reel's length: the website's engine places the part on the song's best part (without it, from the start)
  async function lengthTo(n: number) {
    setLength(n);
    if (!engineOn || !music) return setStart((t) => (n ? Math.max(0, Math.min(t, (music?.duration ?? song?.duration ?? n) - n)) : 0));
    try { setStart((await engine.choose({ length: n })).start); } catch (e) { tell(errorMessage(e), "danger"); }
  }
  // the part dragged on the waves
  async function partFrom(t: number) {
    setStart(t);
    if (engineOn && music) try { setStart((await engine.part(t)).start); } catch (e) { tell(errorMessage(e), "danger"); }
  }
  const keyOf = (list: ImagePicker.ImagePickerAsset[]) => list.map((m) => m.uri).join("|");
  // the clips kept on the phone and read by the website's engine (compressed when heavy, each one analysed), in the popup
  async function readClips(list: ImagePicker.ImagePickerAsset[], sg: Song | null = song) {
    stage.current = "clips"; making.current = true; setWorking(true);
    tasks.start("flow", "clips", words("Adding your clips"), `${words("Clip")} 1 / ${list.length}`);
    try {
      // only the new ones are copied (what is kept stays, unless a clip was taken out or moved)
      const same = kept.current.uris.every((u, i) => u === list[i]?.uri), had = same ? kept.current.clips : [], rest = list.slice(had.length);
      const clips = [...had, ...await keepPickedAssets(draft.current, rest, (n) => tasks.update("flow", (had.length + n) / list.length, `${words("Clip")} ${Math.min(list.length, had.length + n + 1)} / ${list.length}`), had.length)];
      kept.current = { uris: list.map((m) => m.uri), clips };
      let sources = clips;
      if (engineOn && sg) {
        startFresh();
        if (songStopped.current) { setMusic(await engine.songAgain()); songStopped.current = false; heard.current = sg.uri; }
        if (heard.current !== sg.uri) { // the studio started again (the screen was left): it has lost the song and its part
          tasks.update("flow", null, words("Reading your song…"));
          setMusic(await engine.song(sg.uri, sg.name)); heard.current = sg.uri;
          if (length) await engine.choose({ length });
          if (start) await engine.part(start);
        }
        await engine.choose({ order: settings.order, aspect: settings.aspect, mode: styleNow() || "auto" });
        // each clip numbered (phones name many clips the same): the ones the studio kept, in its order
        const names = (await engine.clips(clips.map((c, i) => ({ uri: c.uri, name: `${i + 1}-${c.name}` })))).names;
        if (!making.current) return false;
        // heavy clips (4K / HDR / 60 fps / a changing frame rate): the studio's smooth copies play instead (the phone's
        // preview and export decode them easily; the Reel is the same)
        const copies = new Map((await engine.copies()).map((c) => [c.name, c]));
        sources = names.map((n) => { const c = clips[parseInt(n, 10) - 1], copy = copies.get(n); return c && copy ? { ...c, uri: `file://${copy.path}` } : c; }).filter((c): c is ProjectClip => !!c);
      }
      if (!making.current) return false;
      read.current = { key: keyOf(list), clips, sources }; askAgain.current = false;
      return true;
    } catch (e) { if (making.current) tell(errorMessage(e), "danger"); return false; }
    finally { making.current = false; setWorking(false); tasks.clear("flow"); }
  }
  // Keep old Reel: the clips and song it was made from again, and the editor with it
  async function keepOldReel(old: NonNullable<typeof madeReel.current>) {
    setMedia(old.media); setSong(old.song); setLength(old.length); draft.current = old.id; kept.current = old.kept;
    if (old.song && heard.current !== old.song.uri) await hear(old.song);
    setStart(old.start);
    if (await readClips(old.media, old.song)) { await engine.keptOldReel().catch(() => undefined); setStep("clips"); router.push({ pathname: "/editor", params: { id: old.id } }); }
  }
  async function addMedia() {
    const got = await pickInOrder({ kind: photos ? "image" : "video", limit: Math.max(1, 30 - media.length) }); // in the order tapped ("In my order")
    if (!got) return;
    const list = [...media, ...got].slice(0, 30);
    setMedia(list); await readClips(list);
  }
  // Next after the clips: Free or Add more credits (a plan without Shubix AI), or Shubix AI's question and its work in the popup; the
  // draft saved, then the editor with the Reel. Without the engine (Expo Go) the clips play in turn.
  async function make() {
    // a Reel was made here: nothing changed, the same Reel; changed, a new Reel is asked for (it costs credits), or the old one stays
    const now = `${keyOf(media)};${song?.uri ?? ""};${start};${length}`, old = madeReel.current;
    if (old && old.sig === now) return void router.push({ pathname: "/editor", params: { id: old.id } });
    const again = !!old && (await engine.aiOn().catch(() => false));
    if (again) {
      const v = await askAction({ title: words("You changed your Reel"), body: words("Your song or clips are different now. Make a new Reel with these changes? Keeping the old Reel changes nothing and uses no credits."), ok: words("Make new Reel"), cancel: words("Keep old Reel") });
      if (v === 1) return void keepOldReel(old);
      if (v !== 0) return;
      draft.current = `draft-${Date.now()}`; kept.current = { uris: [], clips: [] }; read.current = null;
    }
    if (read.current?.key !== keyOf(media)) {
      if (askAgain.current && !(await notDone(words("Your clips' analysis did not finish.")))) return;
      if (!(await readClips(media))) return;
    }
    const id = draft.current, { sources } = read.current!, style = styleNow();
    let clips = read.current!.clips, studio = false;
    try {
      if (engineOn && music) {
        if (!(await engine.aiOn())) {
          const v = await askAction({ title: words("Make it perfect with Shubix AI"), body: words("Continue free with your phone's own edit, or add more credits for Shubix AI."), ok: words("Add more credits"), cancel: words("Free") });
          if (v === 0) router.push("/credits");
          if (v !== 1) return;
        }
        stage.current = "ai"; making.current = true; setStep("analyse"); tasks.unlock();   // (the cards stop playing: another step)
        tasks.start("flow", "ai", words("Shubix at work"), words("Getting your Reel ready…"));
        await engine.choose({ order: settings.order, aspect: settings.aspect, mode: style || "auto" }); // (the length and the part are set already)
        if (again) await engine.newReel();
        const went = await engine.ai();
        if (!went && again && making.current) { making.current = false; tasks.clear("flow"); setStep("clips"); return void keepOldReel(old); }   // Shubix AI's question closed: the old Reel
        if (!went || !making.current) { making.current = false; tasks.clear("flow"); setStep("clips"); return; }
        clips = shotsOf((await engine.ready(id)).state.edit, sources.length ? sources : clips); studio = true;
      } else clips = clips.map((c) => ({ ...c, speed: { fast: 1.25, smooth: 0.8, "": 1 }[style] }));
      const audioUri = song ? await keepPickedFile(id, song.uri, `${song.name}.m4a`) : undefined;
      const now = new Date().toISOString();
      await saveProject({ id, title: words(KINDS[kind].title), kind, clips, audioUri, audioName: song?.name, overlays: [], ...(music ? { music } : {}), studio, createdAt: now, updatedAt: now, status: "draft",
        ...(params.templateId ? { templateId: params.templateId } : {}), settings: { start, length, ...settings, ...(wish ? { wish } : {}) } });
      if (old && old.id !== id) { await removeProject(old.id); forgetKeptFiles(old.id); }
      madeReel.current = { id, sig: `${keyOf(media)};${song?.uri ?? ""};${start};${length}`, media, song, start, length, kept: kept.current };
      await queryClient.invalidateQueries({ queryKey: ["drafts"] }); making.current = false; tasks.clear("flow"); tasks.unlock();
      setStep("clips"); router.push({ pathname: "/editor", params: { id } }); // back from the editor: the clips again
    } catch (e) { const gone = !making.current; making.current = false; tasks.clear("flow"); tasks.unlock(); if (!gone) tell(errorMessage(e), "danger"); setStep("clips"); }
  }

  // a new Reel asked for in the editor: its song and clips, read now; Next asks Shubix AI's question as for any new Reel
  useEffect(() => {
    const seed = takeNewReelSeed(); if (!seed) return;
    setPhotos(false); setMedia(seed.media); setSong(seed.song as Song | null); setLength(seed.length); setStep("clips");
    void (async () => { if (seed.song) await hear(seed.song as Song); setStart(seed.start); await readClips(seed.media, seed.song as Song | null); })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the bottom button: its words say what it waits for while it is off (the website's flow.ts)
  const needSong = kind !== "talking";
  const button = {
    intro: { title: words(kind === "copy" ? "Pick the Reel to copy" : "Let's Start"), on: true, press: () => go(order[1]) },
    choose: { title: words(reading ? "Reading your song…" : !song ? "Choose a song to continue" : "Next"), on: !!song && !reading, press: () => void songThen("adjust") },
    adjust: { title: words(reading ? "Reading your song…" : !song ? "Choose a song to continue" : "Next"), on: !!song && !reading, press: () => void songThen("clips") },
    clips: { title: words(!media.length ? (photos ? "Add your photos to continue" : "Add your clips to continue") : needSong && !song ? "Choose a song first" : "Next"), on: !!media.length && (!needSong || !!song), press: () => void make() },
    analyse: null,
  }[step];
  const title = { intro: "", choose: kind === "copy" ? words("Music") : words("Choose Music"), adjust: words("Adjust Music"), clips: words(photos ? "Add Your Photos" : "Add Your Clips"), analyse: "" }[step];
  return (
    <View className="flex-1 bg-background">
      <FlowHead title={title} at={{ intro: 1, choose: 1, adjust: 1, clips: 2, analyse: 3 }[step]} onBack={back} onSkip={step === "intro" ? () => go(order[1]) : undefined} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-6 pt-2" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        {step !== "intro" && step !== "analyse" && <View className="mb-4"><AskShubix onAsk={(t) => { setWish((w) => `${w} · ${t}`.replace(/^ · /, "").slice(-800)); return words("Got it! I'll edit your Reel this way as soon as it is made."); }} /></View>}
        {step === "intro" && <FlowIntro kind={kind} />}
        {step === "choose" && <FlowChoose kind={kind} song={song} recent={recent} busy={reading} onPick={() => void choose(() => pickSong())} onPickReel={() => void choose(() => pickSong("video"))} onRecent={(s) => void pickRecent(s)} onForget={(uri) => { setRecent((r) => r.filter((s) => s.uri !== uri)); if (song?.uri === uri) setSong(null); }} />}
        {step === "adjust" && song && <FlowAdjust song={song} music={music} length={length} start={start} onLength={(n) => void lengthTo(n)} onStart={(t) => void partFrom(t)} />}
        {step === "clips" && <FlowClips kind={kind} photos={photos} onTab={(p) => { setPhotos(p); setMedia([]); }} media={media} onAdd={() => void addMedia()} onRemove={(i) => setMedia((m) => m.filter((_, j) => j !== i))} onMove={(from, to) => setMedia((m) => { const list = [...m], [one] = list.splice(from, 1); list.splice(to, 0, one); return list; })} play={focused && !working && step === "clips"} settings={settings} onSettings={(s) => setSettings((o) => ({ ...o, ...s }))} />}
      </ScrollView>
      {button && <View className="px-4 pt-2" style={{ paddingBottom: Math.max(12, insets.bottom + 4) }}><Button full size="xl" title={button.title} iconAfter={button.on ? "arrow" : undefined} disabled={!button.on} onPress={() => { Keyboard.dismiss(); button.press(); }} /></View>}
    </View>
  );
}
