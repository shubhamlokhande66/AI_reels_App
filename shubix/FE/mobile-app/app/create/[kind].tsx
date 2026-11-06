import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, Platform, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useStudioText } from "@mobile/hooks";
import { Button, askAction, confirmAction, tasks, tell } from "@mobile/ui-mobile";
import { PlanGate } from "../../components/templates/PlanGate";
import type { ProjectClip } from "@mobile/validations";
import { engine, engineOn, keepAwake, onClipRead, shotsOf, type SongAnalysis } from "../../lib/engine";
import { errorMessage } from "@mobile/api-client";
import { forgetKeptFiles, keepPickedAssets, keepPickedFile, removeProject, saveProject, takeNewReelSeed } from "../../lib/projects";
import { notifyAway } from "../../lib/notify";
import { pickSong, recentSongs, songLength, type Song } from "../../lib/songs";
import { AskShubix, styleFromWords } from "../../components/organisms/AskShubix";
import { pickInOrder } from "../../components/organisms/Gallery";
import { FlowAdjust, FlowChoose, FlowClips, FlowHead, FlowIntro, KINDS, ORDER, type ClipSettings, type ClipState, type FlowKind, type FlowStep } from "../../components/organisms/CreateFlow";

/** Create (/create/music, /talking, /photo, /copy): the song and the clips are chosen without waiting: each is read behind
 * the screen, one job after another, and shows how it goes on its own card. Make Reel opens the one popup, with the steps
 * done so far, then Shubix AI; then the editor opens. What was chosen stays as a draft until the Reel is made. */
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
  const [clipState, setClipState] = useState<Record<string, ClipState>>({});
  // the song and the clips are read one after another behind the screen (one heavy job at a time on a phone)
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const later = <T,>(job: () => Promise<T>) => {
    keepAwake(true, words("Shubix is reading your song and clips"));   // also with the screen off, or in another app
    const run = queue.current.then(job, job); queue.current = run.catch(() => undefined).finally(() => keepAwake(false)); return run;
  };
  // what a job finishing behind the screen has changed, for Make Reel, which waited for it
  const now = useRef({ music, start, length }); now.current = { music, start, length };
  const [price, setPrice] = useState<{ on: boolean; cost: number; balance: number | null } | null>(null);
  const lengthChosen = useRef(false), onScreen = useRef(true), DRAFT = `create-draft-${kind}`;
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
    stop(); forgetKeptFiles(draft.current); void AsyncStorage.removeItem(DRAFT); router.replace("/");
  }
  const act = useRef({ cancelWork, cancelReel }); act.current = { cancelWork, cancelReel };
  useFocusEffect(useCallback(() => {
    setFocused(true); onScreen.current = true; tasks.quiet(true); tasks.guard({ onCancel: () => act.current.cancelWork(), onCancelReel: () => void act.current.cancelReel() });
    return () => { setFocused(false); onScreen.current = false; tasks.quiet(false); tasks.guard(null); if (making.current) stop(); };
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => { if (step === "adjust") return go("clips"); const i = order.indexOf(step); if (i <= 0) router.back(); else go(order[i - 1]); };
  useEffect(() => { if (Platform.OS === "web") return; const h = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; }); return () => h.remove(); }); // Android back: the screen before
  // Next while its work was cancelled: the work again, or not; true on Proceed
  const notDone = async (body: string) => {
    const v = await askAction({ title: words("Analysis not done"), body, ok: words("Proceed"), cancel: words("Cancel"), extra: words("Cancel Reel") });
    if (v === 2) void cancelReel();
    return v === 0;
  };

  // a song chosen: on to the clips at once, the song is read behind the screen
  const hearLater = (s: Song) => { const i = order.indexOf("choose"); go(order[i + 1]); void later(() => hear(s)); };
  async function choose(pick: () => Promise<Song | null>) {
    setReading(true);
    try { const s = await pick(); if (s) { setSong(s); hearLater(s); setRecent(await recentSongs()); } } catch (e) { tell(errorMessage(e), "danger"); } finally { setReading(false); }
  }
  async function pickRecent(s: Song) {
    setSong(s.duration ? s : { ...s, duration: await songLength(s.uri) }); hearLater(s);
  }
  // once for this Reel, at its first use of the studio (not on opening this screen: leaving without making a Reel keeps
  // the last Reel's session; a second song for this same Reel does not start it again)
  const startFresh = () => { if (!fresh.current) { fresh.current = true; engine.fresh(); } };
  // the song as the website's engine hears it (its beats, drops and breaks, checked by Shubix: the Reel is cut on them); the popup shows the way
  async function hear(s: Song) {
    setMusic(null); setStart(0); songStopped.current = false;
    if (!engineOn) { tell(words("The song's beats and the Reel's edit are made by the Shubix app: Expo Go cannot run them."), "info"); return false; }
    startFresh(); stage.current = "song"; making.current = true; tasks.start("flow", "music", words("Adding your song"), s.name);
    try {
      const m = await engine.song(s.uri, s.name); setMusic(m); heard.current = s.uri;
      // the Reel's length until the person chooses one: 30 s on the song's best part, a short song whole
      if (!lengthChosen.current && m.duration > 45) { setLength(30); setStart((await engine.choose({ length: 30 })).start); }
      return true;
    }
    catch (e) { if (making.current) tell(errorMessage(e), "danger"); return false; }
    finally { making.current = false; tasks.clear("flow"); }
  }
  // the Reel's length: the website's engine places the part on the song's best part (without it, from the start)
  async function lengthTo(n: number) {
    lengthChosen.current = true; setLength(n);
    if (!engineOn || !music) return setStart((t) => (n ? Math.max(0, Math.min(t, (music?.duration ?? song?.duration ?? n) - n)) : 0));
    try { setStart((await engine.choose({ length: n })).start); } catch (e) { tell(errorMessage(e), "danger"); }
  }
  // the part dragged on the waves
  async function partFrom(t: number) {
    lengthChosen.current = true; setStart(t);
    if (engineOn && music) try { setStart((await engine.part(t)).start); } catch (e) { tell(errorMessage(e), "danger"); }
  }
  const keyOf = (list: ImagePicker.ImagePickerAsset[]) => list.map((m) => m.uri).join("|");
  // the clips kept on the phone and read by the website's engine (compressed when heavy, each one analysed), in the popup
  async function readClips(list: ImagePicker.ImagePickerAsset[], sg: Song | null = song) {
    stage.current = "clips"; making.current = true; setWorking(true);
    tasks.start("flow", "clips", words("Adding your clips"), `${words("Clip")} 1 / ${list.length}`);
    // each clip's card says how it goes (its number in the name it is read by)
    setClipState((was) => Object.fromEntries(list.map((m) => [m.uri, was[m.uri] === "ok" ? "ok" : "wait"])));
    onClipRead((name, ok) => { const m = list[parseInt(name, 10) - 1]; if (m) setClipState((was) => ({ ...was, [m.uri]: ok ? "ok" : "bad" })); });
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
    finally {
      making.current = false; setWorking(false); tasks.clear("flow"); onClipRead(null);
      setClipState((was) => Object.fromEntries(Object.entries(was).filter(([, v]) => v !== "wait")));   // stopped: no card keeps spinning
    }
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
    setMedia(list); void later(() => readClips(list));
  }
  // Next after the clips: Free or Add more credits (a plan without Shubix AI), or Shubix AI's question and its work in the popup; the
  // draft saved, then the editor with the Reel. Without the engine (Expo Go) the clips play in turn.
  async function make() {
    // the one popup from here on, and the screen stays on
    tasks.quiet(false); keepAwake(true, words("Shubix is making your Reel"));
    try { await makeReel(); } finally { keepAwake(false); tasks.note(""); if (onScreen.current) tasks.quiet(true); }
  }
  async function makeReel() {
    // a Reel was made here: nothing changed, the same Reel; changed, a new Reel is asked for (it costs credits), or the old one stays
    const sig = `${keyOf(media)};${song?.uri ?? ""};${start};${length}`, old = madeReel.current;
    if (old && old.sig === sig) return void router.push({ pathname: "/editor", params: { id: old.id } });
    const again = !!old && (await engine.aiOn().catch(() => false));
    if (again) {
      const v = await askAction({ title: words("You changed your Reel"), body: words("Your song or clips are different now. Make a new Reel with these changes? Keeping the old Reel changes nothing and uses no credits."), ok: words("Make new Reel"), cancel: words("Keep old Reel") });
      if (v === 1) return void keepOldReel(old);
      if (v !== 0) return;
      draft.current = `draft-${Date.now()}`; kept.current = { uris: [], clips: [] }; read.current = null;
    }
    // a plan without Shubix AI is asked first, without waiting for the clips
    if (engineOn && song && !(await engine.aiOn().catch(() => true))) {
      const v = await askAction({ title: words("Make it perfect with Shubix AI"), body: words("Continue free with your phone's own edit, or add more credits for Shubix AI."), ok: words("Add more credits"), cancel: words("Free") });
      if (v === 0) router.push("/credits");
      if (v !== 1) return;
    }
    // too few credits: said at once, before any waiting; the Reel can still be made by the phone's own edit
    const p = engineOn && song ? await engine.aiPrice().catch(() => null) : null;
    if (p?.on && p.cost && p.balance !== null && p.balance < p.cost) {
      const v = await askAction({ title: words("Not enough credits"), body: words("Shubix AI needs {n} credits and you have {b}.", { n: p.cost, b: p.balance }), ok: words("Add more credits"), cancel: words("Free edit") });
      if (v === 0) router.push("/credits");
      if (v !== 1) return;
    } else if (p?.on) tasks.note(p.cost && p.balance !== null ? words("Shubix AI: {n} credits · {b} left after", { n: p.cost, b: p.balance - p.cost }) : p.cost ? words("Shubix AI: {n} credits", { n: p.cost }) : words("Shubix AI: included in your plan"));
    // what is still being read behind the screen: the popup shows it now
    await queue.current; await new Promise((ok) => setTimeout(ok, 0));
    if (engineOn && song && !now.current.music) {
      if (songStopped.current && !(await notDone(words("Your song's beat check did not finish.")))) return;
      if (!(await hear(song))) return;
      await new Promise((ok) => setTimeout(ok, 0));
    }
    if (read.current?.key !== keyOf(media)) {
      if (askAgain.current && !(await notDone(words("Your clips' analysis did not finish.")))) return;
      if (!(await readClips(media))) return;
    }
    const id = draft.current, { sources } = read.current!, style = styleNow(), { music: heardMusic, start: at, length: long } = now.current;
    let clips = read.current!.clips, studio = false;
    try {
      if (engineOn && now.current.music) {
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
      const when = new Date().toISOString();
      await saveProject({ id, title: words(KINDS[kind].title), kind, clips, audioUri, audioName: song?.name, overlays: [], ...(heardMusic ? { music: heardMusic } : {}), studio, createdAt: when, updatedAt: when, status: "draft",
        ...(params.templateId ? { templateId: params.templateId } : {}), settings: { start: at, length: long, ...settings, ...(wish ? { wish } : {}) } });
      if (old && old.id !== id) { await removeProject(old.id); forgetKeptFiles(old.id); }
      madeReel.current = { id, sig: `${keyOf(media)};${song?.uri ?? ""};${at};${long}`, media, song, start: at, length: long, kept: kept.current };
      void AsyncStorage.removeItem(DRAFT);
      await queryClient.invalidateQueries({ queryKey: ["drafts"] }); making.current = false; tasks.clear("flow"); tasks.unlock();
      notifyAway(words("Your Reel is ready"), words("Open Shubix to see it"), "/");
      setStep("clips"); router.push({ pathname: "/editor", params: { id } }); // back from the editor: the clips again
    } catch (e) { const gone = !making.current; making.current = false; tasks.clear("flow"); tasks.unlock(); if (!gone) tell(errorMessage(e), "danger"); setStep("clips"); }
  }

  // Shubix AI's price and the balance, on the screen before Make Reel (pressing it is the answer)
  useEffect(() => { if (step === "clips" && focused && engineOn) void engine.aiPrice().then(setPrice).catch(() => setPrice(null)); }, [step, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  const priceLine = !price?.on ? "" : !price.cost ? words("Shubix AI: included in your plan") : price.balance === null ? words("Shubix AI: {n} credits", { n: price.cost }) : words("Shubix AI: {n} credits · You have {b}", { n: price.cost, b: price.balance });
  // what the person chose stays: an app that was closed can go on from it
  useEffect(() => {
    if (!media.length && !song) return;
    void AsyncStorage.setItem(DRAFT, JSON.stringify({ id: draft.current, media, song, length, start, settings, wish })).catch(() => undefined);
  }, [media, song, length, start, settings, wish]); // eslint-disable-line react-hooks/exhaustive-deps
  // the first screen: a new Reel asked for in the editor; a Reel left unfinished; else the intro, the first time only
  useEffect(() => {
    const seed = takeNewReelSeed();
    if (seed) {
      setPhotos(false); setMedia(seed.media); setSong(seed.song as Song | null); setLength(seed.length); setStep("clips"); lengthChosen.current = true;
      void later(async () => { if (seed.song) await hear(seed.song as Song); setStart(seed.start); return readClips(seed.media, seed.song as Song | null); });
      return;
    }
    void (async () => {
      const left = params.templateId ? null : await AsyncStorage.getItem(DRAFT).catch(() => null);
      if (left) {
        const d = JSON.parse(left) as { id: string; media: ImagePicker.ImagePickerAsset[]; song: Song | null; length: number; start: number; settings: ClipSettings; wish: string };
        const v = await askAction({ title: words("Continue your last Reel?"), body: words("The song and clips you chose are still here."), ok: words("Continue"), cancel: words("Start new") });
        if (v === 0) {
          draft.current = d.id; setMedia(d.media); setSong(d.song); setLength(d.length); setSettings(d.settings); setWish(d.wish ?? ""); setStep("clips"); lengthChosen.current = true;
          void later(async () => {
            if (d.song && await hear(d.song)) { if (d.length) await engine.choose({ length: d.length }).catch(() => undefined); if (d.start) setStart((await engine.part(d.start).catch(() => ({ start: d.start }))).start); }
            return d.media.length ? readClips(d.media, d.song) : false;
          });
          return;
        }
        if (v === 1) void AsyncStorage.removeItem(DRAFT);
      }
      if (await AsyncStorage.getItem("create-intro-seen").catch(() => null)) go(order[1]);
      else void AsyncStorage.setItem("create-intro-seen", "1").catch(() => undefined);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the bottom button: its words say what it waits for while it is off (the website's flow.ts)
  const needSong = kind !== "talking";
  const button = {
    intro: { title: words(kind === "copy" ? "Pick the Reel to copy" : "Let's Start"), on: true, press: () => go(order[1]) },
    choose: { title: words(!song ? "Choose a song to continue" : "Next"), on: !!song, press: () => go("clips") },
    adjust: { title: words("Done"), on: true, press: () => go("clips") },
    clips: { title: words(!media.length ? (photos ? "Add your photos to continue" : "Add your clips to continue") : needSong && !song ? "Choose a song first" : "Make Reel"), on: !!media.length && (!needSong || !!song), press: () => void make() },
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
        {step === "clips" && song && needSong && <View className="mb-3"><Button variant="secondary" icon="music" title={words("Adjust music")} onPress={() => go("adjust")} /></View>}
        {step === "clips" && <FlowClips kind={kind} photos={photos} onTab={(p) => { setPhotos(p); setMedia([]); }} media={media} states={media.map((m) => clipState[m.uri])} onAdd={() => void addMedia()} onRemove={(i) => setMedia((m) => m.filter((_, j) => j !== i))} onMove={(from, to) => setMedia((m) => { const list = [...m], [one] = list.splice(from, 1); list.splice(to, 0, one); return list; })} play={focused && !working && step === "clips"} settings={settings} onSettings={(s) => setSettings((o) => ({ ...o, ...s }))} />}
      </ScrollView>
      {button && <View className="gap-1.5 px-4 pt-2" style={{ paddingBottom: Math.max(12, insets.bottom + 4) }}>{step === "clips" && !!priceLine && <Text className="text-center text-[12.5px] font-semibold text-muted">{priceLine}</Text>}<Button full size="xl" title={button.title} iconAfter={button.on ? "arrow" : undefined} disabled={!button.on} onPress={() => { Keyboard.dismiss(); button.press(); }} /></View>}
    </View>
  );
}
