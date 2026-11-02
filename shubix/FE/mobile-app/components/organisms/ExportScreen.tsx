import { useEffect, useState } from "react";
import { Modal, ScrollView, Switch, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStudioText } from "@shubix/hooks";
import { Button, Chip, IconButton, ThemeLayer, colors, toast } from "@shubix/ui-mobile";
import type { IconName } from "@shubix/ui-core";
import { megabytes } from "@shubix/utils";
import { errorMessage } from "@shubix/api-client";
import type { ReelProject } from "@shubix/validations";
import { canUseSharedAndroidRenderer, cancelExport, exportReel, exportReelWithSharedRenderer } from "../../lib/video";
import { FlowAnalyse } from "./CreateFlow";
import { notifyAway } from "../../lib/notify";
import { engine, type ExportChoice, type ExportOptions } from "../../lib/engine";

// the website's Exporting list: each line done once the Reel is that far
const STEPS: [IconName, string, number][] = [["search", "Preparing clips", 0.02], ["sparkle", "Applying effects", 0.3], ["image", "Rendering video", 0.85], ["music", "Finalizing audio", 1]];
const RES = [["720", "720p"], ["1080", "1080p"], ["4k", "4K"]] as const;

/** Export (the website's Export Your Reel, Exporting and Reel Exported! screens): first the choices (quality, frame rate,
 * the watermark, without the song; what the plan does not include is marked Pro and asked about when exporting), then the
 * Reel made into an MP4 on this phone (Cancel stops it), then the Reel to watch, Download (to the gallery) and Share. */
export function ExportScreen({ reel, onClose }: { reel: ReelProject | null; onClose: () => void }) {
  const words = useStudioText(), insets = useSafeAreaInsets();
  const [step, setStep] = useState<"choose" | "make" | "done">("choose"), [allowed, setAllowed] = useState<ExportOptions | null>(null);
  const [choice, setChoice] = useState<Required<ExportChoice>>({ res: "1080", fps: 30, noWatermark: false, noSong: false });
  const [pct, setPct] = useState(0), [done, setDone] = useState<{ uri: string; size: number } | null>(null), [saved, setSaved] = useState(false), [notice, setNotice] = useState(""), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const player = useVideoPlayer(done?.uri ?? null, (p) => { p.loop = true; if (done) p.play(); });
  const studio = !!reel?.studio;
  // a new Reel to export: its choices first (a Studio Reel: what its plan allows), the others start at once
  useEffect(() => {
    if (!reel) return;
    setDone(null); setSaved(false); setNotice(""); setFailed(false); setPct(0); setAllowed(null);
    setStep(reel.studio ? "choose" : "make");
    if (reel.studio) void engine.exportOptions().then(setAllowed).catch(() => setAllowed(null));
  }, [reel]);
  useEffect(() => {
    if (!reel || step !== "make") return;
    let live = true;
    setPct(0); setDone(null); setSaved(false); setNotice(""); setFailed(false);
    // A Studio Reel uses the Studio renderer, so its layers, masks, effects and keyframes survive the export.
    const make = async () => {
      if (reel.studio) {
        if (!engine.holds(reel.id)) throw new Error("The original Studio editing session is not available. Reopen this Reel from Fast Studio before exporting so its advanced effects and layers are preserved.");
        if (!(await engine.edit(reel))) throw new Error("Studio could not sync this edit. Your advanced effects have been kept; reopen the Reel in Fast Studio and try Export again.");
        return engine.exportReel(`${reel.id}.mp4`, choice);
      }
      if (canUseSharedAndroidRenderer(reel)) return exportReelWithSharedRenderer(reel, (p) => live && setPct(p));
      return exportReel(reel, (p) => live && setPct(p));
    };
    make().then(async (r) => {
      if (!live) return;
      setPct(1); setDone(r); setStep("done"); notifyAway(words("Reel Exported!"), words("Your Reel is ready"), "/reels");
      // saved to the gallery at once when allowed (a Photos permission error never undoes the export)
      try {
        if ((await MediaLibrary.requestPermissionsAsync(true)).granted) { await MediaLibrary.createAssetAsync(r.uri); if (live) setSaved(true); }
        else if (live) setNotice(words("Your Reel is ready. Allow Photos access to save it to your gallery."));
      } catch { if (live) setNotice(words("Your Reel is ready. You can still share it or save it later.")); }
    }).catch((e) => { if (live) { toast(errorMessage(e), "danger"); setNotice(words("Export failed. Your draft is still saved. Try again when you are ready.")); setFailed(true); } });
    return () => { live = false; };
  }, [step, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel (and Android back) while it is made: stopped, back to the Reel
  const cancel = () => { void (studio ? engine.cancelExport() : cancelExport()); onClose(); };
  const download = async () => {
    if (!done) return;
    try {
      if (!(await MediaLibrary.requestPermissionsAsync(true)).granted) return toast(words("Allow Shubix to save to your Photos in the phone's settings."), "info");
      await MediaLibrary.createAssetAsync(done.uri); setSaved(true); toast(words("Saved to your phone"), "success");
    } catch { toast(words("Couldn't save to Photos. Your exported video is still available to Share."), "danger"); }
  };
  const pro = (locked?: boolean) => (locked ? " · Pro" : "");
  const label = (s: string) => <Text className="px-1 text-[11px] font-bold uppercase tracking-[2px] text-muted">{words(s)}</Text>;
  const toggle = (title: string, sub: string, on: boolean, set: (v: boolean) => void, disabled = false) => (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
      <View className="min-w-0 flex-1"><Text className="text-[14px] font-semibold text-foreground">{title}</Text>{!!sub && <Text className="text-[12px] text-muted">{sub}</Text>}</View>
      <Switch value={on} onValueChange={set} disabled={disabled} trackColor={{ true: colors.accent }} />
    </View>
  );
  return (
    <Modal visible={!!reel} animationType="slide" onRequestClose={step === "make" && !failed ? cancel : onClose} statusBarTranslucent>
      <ThemeLayer className="bg-background">
        <ScrollView contentContainerClassName="gap-4 px-5" contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }}>
          {step === "choose" ? (
            <>
              <View className="flex-row items-center justify-between"><Text className="text-[22px] font-semibold text-foreground">{words("Export Your Reel")}</Text><IconButton icon="close" label={words("Close")} size={40} onPress={onClose} /></View>
              {label("Quality")}
              <View className="flex-row flex-wrap gap-2">{RES.filter(([r]) => !allowed?.res[r].off).map(([r, name]) => <Chip key={r} label={name + pro(allowed?.res[r].locked)} on={choice.res === r} onPress={() => setChoice((c) => ({ ...c, res: r }))} />)}</View>
              {label("Frame rate")}
              <View className="flex-row flex-wrap gap-2">{([30, 60] as const).map((f) => <Chip key={f} label={`${f} fps${f === 60 ? pro(allowed?.fps60Locked) : ""}`} on={choice.fps === f} onPress={() => setChoice((c) => ({ ...c, fps: f }))} />)}</View>
              {toggle(words("Remove Watermark"), allowed && !allowed.watermarkOff ? words("Paid plans can remove the watermark") : "", choice.noWatermark, (v) => setChoice((c) => ({ ...c, noWatermark: v })), !!allowed && !allowed.watermarkOff)}
              {toggle(words("Without the song"), words("Add it in Instagram as its own sound"), choice.noSong, (v) => setChoice((c) => ({ ...c, noSong: v })))}
              <Button full size="xl" icon="download" title={words("Export to phone")} onPress={() => setStep("make")} />
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
            </>
          )}
        </ScrollView>
      </ThemeLayer>
    </Modal>
  );
}
