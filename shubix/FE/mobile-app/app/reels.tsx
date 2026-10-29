import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, Modal, Pressable, Share, Text, View, useWindowDimensions } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as MediaLibrary from "expo-media-library";
import { useVideoPlayer, VideoView } from "expo-video";
import { useText } from "@shubix/hooks";
import { Badge, Button, Card, EmptyState, Gold, Icon, IconButton, Page, ReelCover, Segmented, colors } from "@shubix/ui-mobile";
import type { CloudReel } from "@shubix/types";
import { clock, formatRelative, megabytes, videoQuality } from "@shubix/utils";
import { AdBanner } from "../components/molecules/AdBanner";
import { mobileApi } from "../lib/api";
import { useDrafts } from "../lib/data";
import { open } from "../lib/navigate";
import { removeProject, type MobileProject } from "../lib/projects";

/** My Reels (the website's app/reels/page.tsx): Drafts are the Reels being made, kept on this phone; Saved are the
 * finished Reels kept in the account (watch, save to the phone, share a link, delete). Every text: Admin → CMS → My Reels. */
export default function ReelsScreen() {
  const text = useText(), drafts = useDrafts();
  const [tab, setTab] = useState<"drafts" | "saved">(useLocalSearchParams<{ tab?: string }>().tab === "saved" ? "saved" : "drafts");
  const saved = useQuery({ queryKey: ["cloud-reels"], queryFn: mobileApi.reels, staleTime: 0, retry: false });
  return (
    <Page>
      <View className="gap-4">
        <Text className="text-[13.5px] leading-[19.6px] text-muted">{text("reels.sub")}</Text>
        <AdBanner place="reels" />
        <Segmented value={tab} onChange={setTab} options={[{ value: "drafts", label: text("reels.drafts"), count: drafts?.length }, { value: "saved", label: text("reels.saved"), count: saved.data?.reels.length }]} />
        {tab === "drafts" ? <Drafts drafts={drafts} /> : <Saved query={saved} />}
      </View>
    </Page>
  );
}

const MakeReel = () => { const text = useText(); return <Button icon="plus" title={text("reels.makeReel")} onPress={() => open("/create/music")} />; };
/** Two a row, 12px apart. */
const useColumn = () => (useWindowDimensions().width - 32 - 12) / 2;

function Drafts({ drafts }: { drafts: MobileProject[] | null }) {
  const text = useText(), queryClient = useQueryClient(), column = useColumn();
  const edit = (draft: MobileProject) => router.push({ pathname: "/editor", params: { id: draft.id } });
  const remove = (draft: MobileProject) => Alert.alert(text("reels.deleteDraftTitle", { name: draft.title }), text("reels.deleteDraftText"), [
    { text: text("common.cancel"), style: "cancel" },
    { text: text("reels.delete"), style: "destructive", onPress: async () => {
      try { await removeProject(draft.id); await queryClient.invalidateQueries({ queryKey: ["drafts"] }); } catch { Alert.alert(text("reels.deleteFailed")); }
    } },
  ]);
  if (drafts === null) return <ActivityIndicator color="accent" />;
  if (!drafts.length) return <EmptyState icon="projects" title={text("reels.noDrafts")} hint={text("reels.noDraftsText")} action={<MakeReel />} />;
  return (
    <View className="flex-row flex-wrap gap-3">
      {drafts.map((draft) => (
        <View key={draft.id} className="min-w-0 gap-2" style={{ width: column }}>
          <Pressable onPress={() => edit(draft)} accessibilityLabel={text("reels.open", { name: draft.title })}>
            <ReelCover thumb={draft.clips.find((c) => c.kind === "image")?.uri} duration={clock(draft.clips.reduce((sum, c) => sum + (c.end - c.start) / c.speed, 0))} />
          </Pressable>
          <View className="flex-row items-start gap-1">
            <Pressable onPress={() => edit(draft)} className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-[13.5px] font-bold text-foreground">{draft.title}</Text>
              <View className="flex-row items-center gap-1.5">
                {draft.kind === "talking" && <Badge className="h-[18px] px-1.5" textClassName="text-[10px]">{text("reels.talking")}</Badge>}
                <Text numberOfLines={1} className="text-[11.5px] text-muted">{text("reels.edited", { when: formatRelative(draft.updatedAt) })}</Text>
              </View>
            </Pressable>
            <IconButton icon="more" look="muted" size={32} label={text("common.more")} onPress={() => Alert.alert(draft.title, undefined, [
              { text: text("common.open"), onPress: () => edit(draft) }, { text: text("reels.delete"), style: "destructive", onPress: () => remove(draft) }, { text: text("common.cancel"), style: "cancel" },
            ])} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Saved({ query }: { query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof mobileApi.reels>>>> }) {
  const text = useText(), column = useColumn(), [watching, setWatching] = useState<{ uri: string; name: string } | null>(null);
  if (query.isError) return (
    <Card className="gap-3 border-danger/35"><Text className="text-[13px] text-danger">{query.error instanceof Error ? query.error.message : text("reels.failed")}</Text><Button size="sm" variant="secondary" title={text("common.retry")} onPress={() => void query.refetch()} /></Card>
  );
  if (!query.data) return <ActivityIndicator color="accent" />;
  const { reels, usage } = query.data, share = Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100);
  return (
    <View className="gap-4">
      <Card className="gap-2.5">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="text-[14px] font-bold text-foreground">{text("reels.spaceTitle")}</Text>
          <Text className="text-[12.5px] text-muted">{text("reels.space", { used: usage.used, limit: usage.limit })}</Text>
        </View>
        <View className="h-2 overflow-hidden rounded-full bg-surface-2">
          <View className={`h-full overflow-hidden rounded-full ${share > 85 ? "bg-warning" : ""}`} style={{ width: `${Math.max(share, usage.used ? 3 : 0)}%` }}>{share <= 85 && <Gold />}</View>
        </View>
        {!!usage.keepDays && <Text className="text-[11.5px] text-muted">{text("reels.keepDays", { days: usage.keepDays })}</Text>}
        <Button size="sm" variant="secondary" icon="crown" title={text("reels.moreSpace")} onPress={() => open("/pricing")} />
      </Card>
      {!reels.length ? <EmptyState icon="upload" title={text("reels.noSaved")} hint={text("reels.noSavedText")} action={<MakeReel />} /> : (
        <View className="flex-row flex-wrap gap-3">
          {reels.map((reel) => <View key={reel.id} style={{ width: column }}><SavedCard reel={reel} onWatch={(uri) => setWatching({ uri, name: reel.name })} onChange={() => void query.refetch()} /></View>)}
        </View>
      )}
      {watching && <Player {...watching} onClose={() => setWatching(null)} />}
    </View>
  );
}

function SavedCard({ reel, onWatch, onChange }: { reel: CloudReel; onWatch: (uri: string) => void; onChange: () => void }) {
  const text = useText(), [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null);
  const flash = (s: string) => { setNote(s); setTimeout(() => setNote(null), 2500); };
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); } catch (e) { flash(e instanceof Error ? e.message : text("reels.failed")); } finally { setBusy(false); } };
  const file = () => mobileApi.downloadReel(reel.id);
  const watch = () => run(async () => onWatch(await file()));
  const save = () => run(async () => {
    if (!(await MediaLibrary.requestPermissionsAsync(true)).granted) throw new Error(text("reels.failed"));
    await MediaLibrary.saveToLibraryAsync(await file()); flash(text("reels.downloaded"));
  });
  const shareLink = () => run(async () => {
    const next = reel.shared ? reel : await mobileApi.shareReel(reel.id, true);
    if (!reel.shared) onChange();
    await Share.share({ title: reel.name, message: mobileApi.absoluteAsset(next.shareUrl!) });
  });
  const remove = () => Alert.alert(text("reels.deleteDraftTitle", { name: reel.name }), text("reels.deleteSavedText"), [
    { text: text("common.cancel"), style: "cancel" },
    { text: text("reels.delete"), style: "destructive", onPress: () => void run(async () => { await mobileApi.deleteReel(reel.id); onChange(); }) },
  ]);
  return (
    <View className="min-w-0 gap-2">
      <Pressable onPress={() => void watch()} accessibilityLabel={text("reels.watch", { name: reel.name })}>
        <ReelCover thumb={reel.thumb && mobileApi.absoluteAsset(reel.thumb)} duration={clock(reel.dur)}>
          {reel.shared && <View className="absolute right-2 top-2"><Badge tone="dark">{text("reels.linkOn")}</Badge></View>}
        </ReelCover>
      </Pressable>
      <View className="min-w-0">
        <Text numberOfLines={1} className="text-[13.5px] font-bold text-foreground">{reel.name}</Text>
        <Text numberOfLines={1} className="text-[11.5px] text-muted">{videoQuality(reel)} · {megabytes(reel.size)}</Text>
      </View>
      <View className="flex-row items-center gap-1 rounded-xl border border-border bg-surface p-1">
        <IconButton icon="download" look="plain" size={32} iconSize={15} disabled={busy} label={`${text("reels.download")} ${reel.name}`} onPress={() => void save()} className="flex-1 rounded-lg" />
        <IconButton icon="share" look="plain" size={32} iconSize={15} disabled={busy} label={`${text("reels.share")}: ${reel.name}`} onPress={() => void shareLink()} className="flex-1 rounded-lg" />
        <IconButton icon="trash" look="danger" size={32} iconSize={15} disabled={busy} label={`${text("reels.delete")} ${reel.name}`} onPress={remove} className="flex-1 rounded-lg" />
      </View>
      {busy && <ActivityIndicator size="small" color="accent" />}
      {note && <Text className="text-[11.5px] font-semibold text-accent">{note}</Text>}
    </View>
  );
}

/** A saved Reel playing over the page, with a close button. */
function Player({ uri, name, onClose }: { uri: string; name: string; onClose: () => void }) {
  const text = useText(), player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-black">
        <VideoView player={player} nativeControls contentFit="contain" style={{ flex: 1 }} accessibilityLabel={name} />
        <View className="absolute right-4 top-12"><IconButton icon="close" label={text("common.close")} onPress={onClose} /></View>
      </View>
    </Modal>
  );
}
