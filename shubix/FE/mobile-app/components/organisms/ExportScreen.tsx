import { useEffect, useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStudioText } from "@shubix/hooks";
import { Button, IconButton, ThemeLayer, toast } from "@shubix/ui-mobile";
import type { IconName } from "@shubix/ui-core";
import { megabytes } from "@shubix/utils";
import { errorMessage } from "@shubix/api-client";
import type { ReelProject } from "@shubix/validations";
import { cancelExport, exportReel } from "../../lib/video";
import { FlowAnalyse } from "./CreateFlow";
import { notifyAway } from "../../lib/notify";
import { engine } from "../../lib/engine";

// the website's Exporting list: each line done once the Reel is that far
const STEPS: [IconName, string, number][] = [["search", "Preparing clips", 0.02], ["sparkle", "Applying effects", 0.3], ["image", "Rendering video", 0.85], ["music", "Finalizing audio", 1]];

/** Export (the website's Exporting and Reel Exported! screens): the Reel made into an MP4 on this phone, the ring and
 * the steps meanwhile, then the Reel to watch, its size, Share and Save to Photos (saved there at once when allowed). */
export function ExportScreen({ reel, onClose }: { reel: ReelProject | null; onClose: () => void }) {
  const words = useStudioText(), insets = useSafeAreaInsets();
  const [pct, setPct] = useState(0), [done, setDone] = useState<{ uri: string; size: number } | null>(null), [saved, setSaved] = useState(false);
  const player = useVideoPlayer(done?.uri ?? null, (p) => { p.loop = true; });
  useEffect(() => {
    if (!reel) return;
    let live = true;
    setPct(0); setDone(null); setSaved(false);
    // made by the website's engine (the editor's changes sent back to it): its own export (the transitions and effects); else the phone's
    (reel.studio ? engine.edit(reel).catch(() => false) : Promise.resolve(false)).then((studio) => studio ? engine.exportReel(`${reel.id}.mp4`) : exportReel(reel, (p) => live && setPct(p)))
      .then(async (r) => {
        if (!live) return;
        setPct(1); setDone(r); notifyAway(words("Reel Exported!"), words("Your Reel is ready"), "/reels");
        const ok = (await MediaLibrary.requestPermissionsAsync(true)).granted;
        if (ok) { await MediaLibrary.createAssetAsync(r.uri); setSaved(true); }
      })
      .catch((e) => { if (live) { toast(errorMessage(e), "danger"); onClose(); } });
    return () => { live = false; };
  }, [reel]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!done) return;
    if (!(await MediaLibrary.requestPermissionsAsync(true)).granted) return toast(words("Allow Shubix to save to your Photos in the phone's settings."), "info");
    await MediaLibrary.createAssetAsync(done.uri); setSaved(true); toast(words("Saved to your phone"), "success");
  };
  return (
    <Modal visible={!!reel} animationType="slide" onRequestClose={() => { if (done) onClose(); }} statusBarTranslucent>
      <ThemeLayer className="bg-background">
        <ScrollView contentContainerClassName="gap-4 px-5" contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }}>
          {!done ? (
            <>
              <FlowAnalyse title="Exporting" pct={pct} done={STEPS.filter(([, , at]) => pct >= at).length} status={words("Making your Reel…")} sub={words("This may take a few moments. Please keep this screen open.")} steps={STEPS.map(([i, t]) => [i, t])} />
              <Button full variant="secondary" title={words("Cancel")} onPress={() => { void cancelExport(); onClose(); }} />
            </>
          ) : (
            <>
              <IconButton icon="back" label={words("Back to your Reel")} size={40} onPress={onClose} />
              <Text className="text-center text-[40px]">🎉</Text>
              <Text className="text-center text-[24px] font-semibold text-foreground">{words("Reel Exported!")}</Text>
              <View className="h-[380px] self-center overflow-hidden rounded-[18px] bg-black" style={{ aspectRatio: 9 / 16 }}><VideoView player={player} surfaceType="textureView" nativeControls contentFit="contain" style={{ flex: 1 }} /></View>
              <View className="items-center"><Text className="text-[15px] font-semibold text-foreground">{words(saved ? "Saved to your phone" : "Your Reel is ready")}</Text><Text className="text-[12.5px] text-muted">{megabytes(done.size)}</Text></View>
              <Button full size="xl" icon="upload" title={words("Share")} onPress={() => void Sharing.shareAsync(done.uri, { mimeType: "video/mp4" })} />
              {!saved && <Button full size="lg" variant="secondary" icon="download" title={words("Save to Photos")} onPress={() => void save()} />}
            </>
          )}
        </ScrollView>
      </ThemeLayer>
    </Modal>
  );
}
