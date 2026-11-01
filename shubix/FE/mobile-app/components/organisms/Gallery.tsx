import { useEffect, useState } from "react";
import { FlatList, Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStudioText } from "@shubix/hooks";
import { Button, Icon, ThemeLayer } from "@shubix/ui-mobile";
import { Thumb } from "./CreateFlow";

/** Shubix's own gallery: the phone's videos (or photos), newest first; each tap numbers a clip (1, 2, 3…, a second tap
 * takes it out) and the clips come back in exactly that order ("In my order"). Android's own picker cannot promise the
 * order (many phones give the clips newest first), this can. Without the gallery permission, in a browser or before the
 * host is mounted: the system picker. */
type Want = { kind: "video" | "image" | "both"; limit: number };
type Asset = ImagePicker.ImagePickerAsset;
let show: ((w: Want, done: (a: Asset[] | null) => void) => void) | null = null;

const TYPES = { video: [MediaLibrary.MediaType.video], image: [MediaLibrary.MediaType.photo], both: [MediaLibrary.MediaType.video, MediaLibrary.MediaType.photo] };
const systemPick = async ({ kind, limit }: Want) => {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: kind === "both" ? ["videos", "images"] : kind === "video" ? ["videos"] : ["images"], allowsMultipleSelection: limit > 1, orderedSelection: true, selectionLimit: limit, quality: 0.9 });
  return r.canceled ? null : r.assets;
};

/** The clips chosen, in the order tapped (null: closed without choosing). */
export async function pickInOrder(want: Want): Promise<Asset[] | null> {
  if (Platform.OS === "web" || !show) return systemPick(want);
  const p = await MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]).catch(() => null);
  if (!p?.granted) return systemPick(want);
  return new Promise((resolve) => show!(want, resolve));
}

// a gallery item as the picker gives one (the file's own address: iOS keeps ph:// ids, the file is asked for)
async function asAsset(a: MediaLibrary.Asset): Promise<Asset> {
  const uri = Platform.OS === "ios" ? (await MediaLibrary.getAssetInfoAsync(a)).localUri ?? a.uri : a.uri;
  return { uri, assetId: a.id, fileName: a.filename, width: a.width, height: a.height, type: a.mediaType === "photo" ? "image" : "video", duration: a.mediaType === "video" ? a.duration * 1000 : null };
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function GalleryHost() {
  const words = useStudioText(), insets = useSafeAreaInsets(), { width } = useWindowDimensions();
  const [want, setWant] = useState<Want | null>(null), [done, setDone] = useState<((a: Asset[] | null) => void) | null>(null);
  const [items, setItems] = useState<MediaLibrary.Asset[]>([]), [after, setAfter] = useState<string | undefined>(), [more, setMore] = useState(true);
  const [picked, setPicked] = useState<MediaLibrary.Asset[]>([]), [limited, setLimited] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { show = (w, d) => { setWant(w); setDone(() => d); setItems([]); setAfter(undefined); setMore(true); setPicked([]); }; return () => { show = null; }; }, []);

  async function load(reset = false) {
    if (!want || (!reset && !more)) return;
    const r = await MediaLibrary.getAssetsAsync({ first: 60, after: reset ? undefined : after, mediaType: TYPES[want.kind], sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
    setItems((old) => (reset ? r.assets : [...old, ...r.assets])); setAfter(r.endCursor); setMore(r.hasNextPage);
  }
  useEffect(() => {
    if (!want) return;
    void MediaLibrary.getPermissionsAsync(false, ["photo", "video"]).then((p) => setLimited(p.accessPrivileges === "limited"));
    void load(true);
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (out: Asset[] | null) => { done?.(out); setWant(null); setDone(null); };
  const tap = (a: MediaLibrary.Asset) => setPicked((p) => (p.some((x) => x.id === a.id) ? p.filter((x) => x.id !== a.id) : p.length < (want?.limit ?? 30) ? [...p, a] : p));
  async function finish() { setBusy(true); try { close(await Promise.all(picked.map(asAsset))); } finally { setBusy(false); } }
  const cell = (width - 4 * 3) / 3;
  const title = want?.kind === "image" ? "Choose photos" : "Choose clips";

  return (
    <Modal visible={!!want} animationType="slide" onRequestClose={() => close(null)} statusBarTranslucent>
      <ThemeLayer className="flex-1 bg-background"><View className="flex-1" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
          <Pressable onPress={() => close(null)} hitSlop={8} accessibilityRole="button"><Text className="text-[14px] text-muted">{words("Cancel")}</Text></Pressable>
          <View className="flex-1 items-center">
            <Text className="text-[15px] font-semibold text-foreground">{words(title)}</Text>
            <Text className="text-[11.5px] text-muted">{picked.length ? words("{n} chosen · tap in the order they should play", { n: String(picked.length) }) : words("Tap them in the order they should play")}</Text>
          </View>
          <Button title={words("Add")} disabled={!picked.length} loading={busy} onPress={() => void finish()} />
        </View>
        {limited && (
          <Pressable onPress={() => void MediaLibrary.presentPermissionsPickerAsync().then(() => load(true))} className="flex-row items-center gap-2 bg-accent/10 px-4 py-2.5">
            <Icon name="bulb" size={15} color="accent" />
            <Text className="flex-1 text-[12px] text-foreground">{words("Shubix sees only some of your videos. Tap to choose more.")}</Text>
          </Pressable>
        )}
        <FlatList data={items} keyExtractor={(a) => a.id} numColumns={3} columnWrapperStyle={{ gap: 3 }} contentContainerStyle={{ gap: 3, paddingTop: 3 }}
          onEndReached={() => void load()} onEndReachedThreshold={0.6} initialNumToRender={18} windowSize={7}
          ListEmptyComponent={<Text className="p-8 text-center text-[13px] text-muted">{words(more ? "Loading…" : "Nothing here yet.")}</Text>}
          renderItem={({ item }) => {
            const n = picked.findIndex((x) => x.id === item.id) + 1;
            return (
              <Pressable onPress={() => tap(item)} accessibilityRole="checkbox" accessibilityState={{ checked: n > 0 }} style={{ width: cell, height: cell }} className="overflow-hidden bg-surface-2">
                <Thumb uri={item.uri} kind={item.mediaType === "photo" ? "image" : "video"} />
                {item.mediaType === "video" && <View className="absolute bottom-1 right-1 rounded-full bg-black/65 px-1.5 py-0.5"><Text className="text-[10.5px] font-semibold text-white">{clock(item.duration)}</Text></View>}
                {n > 0 && <View className="absolute inset-0 border-[3px] border-accent bg-accent/15" />}
                <View className={`absolute right-1.5 top-1.5 h-6 min-w-6 items-center justify-center rounded-full px-1 ${n ? "bg-accent" : "border-[1.5px] border-white/90 bg-black/25"}`}>
                  {n > 0 && <Text className="text-[12px] font-bold text-background">{n}</Text>}
                </View>
              </Pressable>
            );
          }} />
      </View></ThemeLayer>
    </Modal>
  );
}
