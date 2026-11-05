import { useAdPlan } from "../molecules/AdBanner";
import { showInterstitial } from "../../lib/ads";
import { useEffect, useState } from "react";
import { Image, Modal, Platform, ScrollView, Switch, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStudioText } from "@mobile/hooks";
import { Button, Chip, IconButton, ThemeLayer, colors, tell } from "@mobile/ui-mobile";
import type { IconName } from "@mobile/ui-core";
import { megabytes } from "@mobile/utils";
import { errorMessage } from "@mobile/api-client";
import type { ReelProject } from "@mobile/validations";
import { canUseSharedAndroidRenderer, cancelExport, exportReel, exportReelWithSharedRenderer, nativeExportGaps, type NativeLayerRow } from "../../lib/video";
import { FlowAnalyse } from "./CreateFlow";
import { notifyAway } from "../../lib/notify";
import { useThumb } from "../../lib/thumbs";
import { engine, type ExportChoice, type ExportOptions } from "../../lib/engine";

// the website's Exporting list: each line done once the Reel is that far
const STEPS: [IconName, string, number][] = [["search", "Preparing clips", 0.02], ["sparkle", "Applying effects", 0.3], ["image", "Rendering video", 0.85], ["music", "Finalizing audio", 1]];
const RES = [["720", "720p"], ["1080", "1080p"], ["4k", "4K"]] as const;
type Made = { uri: string; size: number; caption?: string };

/** Export (the website's Export Your Reel, Exporting and Reel Exported! screens): first the Reel's picture and the choices
 * (quality, frame rate, the size it will be, its file name, the watermark, without the song, Save to My Reels); what the
 * plan does not include is listed and taken out before the export (the app never sends people to buy), then the Reel made
 * into an MP4 on this phone (Cancel stops it), then the Reel to watch, Download, Share and the caption for the post. */
/** the test APK: the same Reel from both engines in the gallery, named for scripts/parity.mjs */
async function saveParityPair(reel: ReelProject, engineUri: string, choice: ExportChoice) {
  const rows = await engine.tool("layerList"), layers = Array.isArray(rows) ? rows as NativeLayerRow[] : [];
  const { path, plan } = await engine.exportMix(`${reel.id}-mix.wav`, choice);
  const gaps = nativeExportGaps(reel, layers);
  if (gaps.length) tell(`Parity: the native export has no ${gaps.join(", ")} yet`, "info");
  const native = await exportReel(reel, () => {}, { mix: path, layers, plan }), stamp = Date.now();
  if (!(await MediaLibrary.requestPermissionsAsync(true)).granted) return;
  for (const [kind, uri] of [["engine", engineUri], ["native", native.uri]]) {
    const copy = new File(Paths.cache, `parity-${kind}-${stamp}.mp4`);
    new File(uri).copy(copy);
    await MediaLibrary.createAssetAsync(copy.uri);
  }
  tell("Parity pair saved", "info");
}

export function ExportScreen({ reel, onClose }: { reel: ReelProject | null; onClose: () => void }) {
  const words = useStudioText(), insets = useSafeAreaInsets();
  const [step, setStep] = useState<"choose" | "make" | "done">("choose"), [allowed, setAllowed] = useState<ExportOptions | null>(null);
  const [choice, setChoice] = useState<Required<Omit<ExportChoice, "fixLocked">>>({ res: "1080", fps: 30, noWatermark: false, noSong: false, myReels: true });
  const [pct, setPct] = useState(0), [done, setDone] = useState<Made | null>(null), [saved, setSaved] = useState(false), [notice, setNotice] = useState(""), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const player = useVideoPlayer(done?.uri ?? null, (p) => { p.loop = true; if (done) p.play(); });
  const first = reel?.clips[0], picture = useThumb(first?.uri, first?.kind === "image" ? "image" : "video");
  // the plans with ads: a full-screen ad once the Reel is made (never while editing)
  const { ads, adPlan } = useAdPlan(), full = Platform.OS === "android" ? ads.data?.admob?.interstitial ?? "" : "";
  const studio = !!reel?.studio, locked = allowed?.locked ?? [];
  // a new Reel: its choices first (a Studio Reel), the others start at once
  useEffect(() => { if (!reel) return; setDone(null); setSaved(false); setNotice(""); setFailed(false); setPct(0); setAllowed(null); setStep(reel.studio ? "choose" : "make"); }, [reel]);
  // what the plan allows, the size and the name, for these choices (the studio on this phone answers: no request to the server)
  useEffect(() => { if (reel?.studio && step === "choose") void engine.exportOptions(choice).then(setAllowed).catch(() => setAllowed(null)); }, [reel, step, choice]);
  useEffect(() => {
    if (!reel || step !== "make") return;
    let live = true;
    setPct(0); setDone(null); setSaved(false); setNotice(""); setFailed(false);
    // A Studio Reel uses the Studio renderer, so its layers, masks, effects and keyframes survive the export.
    const make = async (): Promise<Made> => {
      if (reel.studio) {
        if (!engine.holds(reel.id)) throw new Error("The original Studio editing session is not available. Reopen this Reel from Fast Studio before exporting so its advanced effects and layers are preserved.");
        if (!(await engine.edit(reel))) throw new Error("Studio could not sync this edit. Your advanced effects have been kept; reopen the Reel in Fast Studio and try Export again.");
        return engine.exportReel(`${reel.id}.mp4`, { ...choice, fixLocked: true }); // the person saw the list and chose Export
      }
      if (canUseSharedAndroidRenderer(reel)) return exportReelWithSharedRenderer(reel, (p) => live && setPct(p));
      return exportReel(reel, (p) => live && setPct(p));
    };
    make().then(async (r) => {
      if (!live) return;
      setPct(1); setDone(r); setStep("done"); if (adPlan && full) void showInterstitial(full); notifyAway(words("Reel Exported!"), words("Your Reel is ready"), "/reels");
      // the test APK only: the native engine makes the same Reel, both go to the gallery for scripts/parity.mjs
      if (reel.studio && process.env.EXPO_PUBLIC_WEBVIEW_DEBUG === "1") void saveParityPair(reel, r.uri, choice).catch((e) => tell(`Native export: ${errorMessage(e)}`, "danger"));
      // saved to the gallery at once when allowed (a Photos permission error never undoes the export)
      try {
        if ((await MediaLibrary.requestPermissionsAsync(true)).granted) { await MediaLibrary.createAssetAsync(r.uri); if (live) setSaved(true); }
        else if (live) setNotice(words("Your Reel is ready. Allow Photos access to save it to your gallery."));
      } catch { if (live) setNotice(words("Your Reel is ready. You can still share it or save it later.")); }
    }).catch((e) => { if (live) { tell(errorMessage(e), "danger"); setNotice(words("Export failed. Your draft is still saved. Try again when you are ready.")); setFailed(true); } });
    return () => { live = false; };
  }, [step, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel (and Android back) while it is made: stopped, back to the Reel
  const cancel = () => { void (studio ? engine.cancelExport() : cancelExport()); onClose(); };
  const download = async () => {
    if (!done) return;
    try {
      if (!(await MediaLibrary.requestPermissionsAsync(true)).granted) return tell(words("Allow Shubix to save to your Photos in the phone's settings."), "info");
      await MediaLibrary.createAssetAsync(done.uri); setSaved(true); tell(words("Saved to your phone"), "success");
    } catch { tell(words("Couldn't save to Photos. Your exported video is still available to Share."), "danger"); }
  };
  const pro = (on?: boolean) => (on ? " · Pro" : "");
  const set = (patch: Partial<typeof choice>) => setChoice((c) => ({ ...c, ...patch }));
  const label = (s: string) => <Text className="px-1 text-[11px] font-bold uppercase tracking-[2px] text-muted">{words(s)}</Text>;
  const toggle = (title: string, sub: string, on: boolean, change: (v: boolean) => void, disabled = false) => (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
      <View className="min-w-0 flex-1"><Text className="text-[14px] font-semibold text-foreground">{title}</Text>{!!sub && <Text className="text-[12px] text-muted">{sub}</Text>}</View>
      <Switch value={on} onValueChange={change} disabled={disabled} trackColor={{ true: colors.accent }} />
    </View>
  );
  return (
    <Modal visible={!!reel} animationType="slide" onRequestClose={step === "make" && !failed ? cancel : onClose} statusBarTranslucent>
      <ThemeLayer className="bg-background">
        <ScrollView contentContainerClassName="gap-4 px-5" contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }}>
          {step === "choose" ? (
            <>
              <View className="flex-row items-center justify-between"><Text className="text-[22px] font-semibold text-foreground">{words("Export Your Reel")}</Text><IconButton icon="close" label={words("Close")} size={40} onPress={onClose} /></View>
              <View className="h-[220px] self-center overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: 9 / 16 }}>{picture && <Image source={{ uri: picture }} resizeMode="cover" className="h-full w-full" />}</View>
              {label("Quality")}
              <View className="flex-row flex-wrap gap-2">{RES.filter(([r]) => !allowed?.res[r].off).map(([r, name]) => <Chip key={r} label={name + pro(allowed?.res[r].locked)} on={choice.res === r} onPress={() => set({ res: r })} />)}</View>
              {label("Frame rate")}
              <View className="flex-row flex-wrap gap-2">{([30, 60] as const).map((f) => <Chip key={f} label={`${f} fps${f === 60 ? pro(allowed?.fps60Locked) : ""}`} on={choice.fps === f} onPress={() => set({ fps: f })} />)}</View>
              {!!allowed?.size && <Text className="px-1 text-[12.5px] text-muted">{allowed.size}</Text>}
              {!!allowed?.fileName && <Text className="px-1 text-[12.5px] text-muted">{words("File name")}: <Text className="font-semibold text-foreground">{allowed.fileName}</Text></Text>}
              {toggle(words("Remove Watermark"), allowed && !allowed.watermarkOff ? words("Paid plans can remove the watermark") : "", choice.noWatermark, (v) => set({ noWatermark: v }), !!allowed && !allowed.watermarkOff)}
              {allowed?.myReels && toggle(words("Save to My Reels"), allowed.myReelsNote, choice.myReels, (v) => set({ myReels: v }))}
              {toggle(words("Without the song"), words("Add it in Instagram as its own sound"), choice.noSong, (v) => set({ noSong: v }))}
              {locked.length > 0 && (
                <View className="gap-1 rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3">
                  <Text className="text-[14px] font-semibold text-foreground">{words("Your Reel uses features your plan does not include")}</Text>
                  {locked.map((x) => <Text key={x.name} className="text-[12.5px] text-muted">• {x.name} · {x.need}</Text>)}
                  <Text className="mt-1 text-[12px] text-muted">{words("They are taken out when you export.")}</Text>
                </View>
              )}
              <Button full size="xl" icon="download" title={words(locked.length ? "Take them out and export" : "Export to phone")} onPress={() => setStep("make")} />
            </>
          ) : step === "make" ? (
            <>
              <FlowAnalyse title="Exporting" pct={pct} done={STEPS.filter(([, , at]) => pct >= at).length} status={words("Making your Reel…")} sub={words("This may take a few moments. Please keep this screen open.")} steps={STEPS.map(([i, t]) => [i, t])} />
              {!!notice && <Text accessibilityRole="alert" className="text-center text-[12px] text-danger">{notice}</Text>}
              {failed
                ? <><Button full title={words("Try export again")} onPress={() => setAttempt((n) => n + 1)} /><Button full variant="secondary" title={words("Back to your Reel")} onPress={onClose} /></>
                : <Button full variant="secondary" title={words("Cancel export")} onPress={cancel} />}
            </>
          ) : done && (
            <>
              <IconButton icon="back" label={words("Back to your Reel")} size={40} onPress={onClose} />
              <Text className="text-center text-[40px]">🎉</Text>
              <Text className="text-center text-[24px] font-semibold text-foreground">{words("Reel Exported!")}</Text>
              <View className="h-[380px] self-center overflow-hidden rounded-[18px] bg-black" style={{ aspectRatio: 9 / 16 }}><VideoView player={player} surfaceType="textureView" nativeControls contentFit="contain" style={{ flex: 1 }} /></View>
              <View className="items-center gap-1"><Text className="text-[15px] font-semibold text-foreground">{words(saved ? "Saved to your phone" : "Your Reel is ready")}</Text><Text className="text-[12.5px] text-muted">{megabytes(done.size)}</Text>{!!notice && <Text accessibilityRole="alert" className="text-center text-[12px] text-muted">{notice}</Text>}</View>
              <Button full size="xl" icon="upload" title={words("Share")} onPress={() => void Sharing.shareAsync(done.uri, { mimeType: "video/mp4" })} />
              <Button full size="lg" variant="secondary" icon={saved ? "check" : "download"} title={words(saved ? "Saved to Photos" : "Download")} onPress={() => void download()} />
              {!!done.caption && (
                <View className="gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
                  <Text className="text-[14px] font-semibold text-foreground">{words("Caption for your Post")}</Text>
                  <Text selectable className="text-[13px] leading-5 text-foreground">{done.caption}</Text>
                  <Button variant="secondary" size="sm" title={words("Copy caption")} onPress={() => void Clipboard.setStringAsync(done.caption!).then(() => tell(words("Copied ✓"), "success"))} />
                </View>
              )}
            </>
          )}
        </ScrollView>
      </ThemeLayer>
    </Modal>
  );
}
