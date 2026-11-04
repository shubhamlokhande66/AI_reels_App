import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { ImagePickerAsset } from "expo-image-picker";
import * as MediaLibrary from "expo-media-library/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStudioText } from "@mobile/hooks";
import { Button, Icon, ThemeLayer } from "@mobile/ui-mobile";
import { songLength } from "../../lib/songs";
import { Thumb } from "./CreateFlow";

/** Shubix's own gallery, as WhatsApp's: the phone's videos (or photos) newest first, its albums along the top (Camera,
 * WhatsApp, Downloads, Screenshots… every folder on the phone and the SD card); each tap numbers a clip (1, 2, 3…, a
 * second tap takes it out) and the clips come back in exactly that order ("In my order"). "Files" opens the phone's file
 * picker for anything else (Drive, other apps). Without the gallery permission, or in a browser: that file picker. */
type Want = { kind: "video" | "image" | "both"; limit: number };
type Asset = ImagePickerAsset;
type Album = { id: string; title: string; count: number };
let show: ((w: Want, done: (a: Asset[] | null) => void) => void) | null = null;

const TYPES = { video: [MediaLibrary.MediaType.video], image: [MediaLibrary.MediaType.photo], both: [MediaLibrary.MediaType.video, MediaLibrary.MediaType.photo] };
const GAP = 3, PAGE = 90;
// the phone's file picker: every place it keeps files
const filePick = async ({ kind, limit }: Want): Promise<Asset[] | null> => {
  const r = await DocumentPicker.getDocumentAsync({ type: kind === "both" ? ["video/*", "image/*"] : [`${kind}/*`], multiple: limit > 1, copyToCacheDirectory: true });
  if (r.canceled || !r.assets.length) return null;
  return Promise.all(r.assets.slice(0, limit).map(async (f) => {
    const image = !!f.mimeType?.startsWith("image/");
    return { uri: f.uri, fileName: f.name, fileSize: f.size, mimeType: f.mimeType, width: 0, height: 0, type: image ? "image" : "video", duration: image ? null : (await songLength(f.uri)) * 1000 || null };
  }));
};

/** The clips chosen, in the order tapped (null: closed without choosing). */
export async function pickInOrder(want: Want): Promise<Asset[] | null> {
  if (Platform.OS === "web" || !show) return filePick(want);
  const p = await MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]).catch(() => null);
  if (!p?.granted) return filePick(want);
  return new Promise((resolve) => show!(want, resolve));
}

// a gallery item as the picker gives one (the file's own address: iOS keeps ph:// ids, the file is asked for)
async function asAsset(a: MediaLibrary.Asset): Promise<Asset> {
  const uri = Platform.OS === "ios" ? (await MediaLibrary.getAssetInfoAsync(a)).localUri ?? a.uri : a.uri;
  return { uri, assetId: a.id, fileName: a.filename, width: a.width, height: a.height, type: a.mediaType === "photo" ? "image" : "video", duration: a.mediaType === "video" ? a.duration * 1000 : null };
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** One square. Android draws a video's picture from the phone's own thumbnail (fast, small, cached, as WhatsApp does);
 * redrawn only when its number changes, so scrolling stays smooth. */
const Cell = memo(function Cell({ item, n, size, onTap }: { item: MediaLibrary.Asset; n: number; size: number; onTap: (a: MediaLibrary.Asset) => void }) {
  const video = item.mediaType === "video";
  return (
    <Pressable onPress={() => onTap(item)} accessibilityRole="checkbox" accessibilityState={{ checked: n > 0 }} style={{ width: size, height: size }} className="overflow-hidden bg-surface-2">
      {Platform.OS === "android" || !video ? <Image source={{ uri: item.uri, width: size, height: size }} resizeMethod="resize" resizeMode="cover" fadeDuration={0} className="h-full w-full" /> : <Thumb uri={item.uri} kind="video" />}
      {video && <View className="absolute bottom-1 right-1 rounded-full bg-black/65 px-1.5 py-0.5"><Text className="text-[10.5px] font-semibold text-white">{clock(item.duration)}</Text></View>}
      {n > 0 && <View className="absolute inset-0 border-[3px] border-accent bg-accent/15" />}
      <View className={`absolute right-1.5 top-1.5 h-6 min-w-6 items-center justify-center rounded-full px-1 ${n ? "bg-accent" : "border-[1.5px] border-white/90 bg-black/25"}`}>
        {n > 0 && <Text className="text-[12px] font-bold text-background">{n}</Text>}
      </View>
    </Pressable>
  );
});

const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} className={`rounded-full border px-3.5 py-1.5 ${on ? "border-accent bg-accent" : "border-border bg-surface"}`}>
    <Text numberOfLines={1} className={`text-[12.5px] font-semibold ${on ? "text-background" : "text-foreground"}`}>{label}</Text>
  </Pressable>
);

export function GalleryHost() {
  const words = useStudioText(), insets = useSafeAreaInsets(), { width } = useWindowDimensions();
  const [want, setWant] = useState<Want | null>(null), [done, setDone] = useState<((a: Asset[] | null) => void) | null>(null);
  const [items, setItems] = useState<MediaLibrary.Asset[]>([]), [more, setMore] = useState(true), [albums, setAlbums] = useState<Album[]>([]), [album, setAlbum] = useState<string | undefined>();
  const [picked, setPicked] = useState<MediaLibrary.Asset[]>([]), [limited, setLimited] = useState(false), [busy, setBusy] = useState(false);
  const page = useRef({ after: undefined as string | undefined, loading: false, gen: 0 });
  useEffect(() => { show = (w, d) => { setWant(w); setDone(() => d); setPicked([]); setAlbum(undefined); }; return () => { show = null; }; }, []);

  // one page at a time (a second call while one loads is dropped: no doubled squares, no jumping)
  async function load(reset = false) {
    const pg = page.current;
    if (!want || (!reset && (!more || pg.loading))) return;
    const gen = reset ? ++pg.gen : pg.gen;
    pg.loading = true;
    try {
      const r = await MediaLibrary.getAssetsAsync({ first: PAGE, after: reset ? undefined : pg.after, album, mediaType: TYPES[want.kind], sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
      if (gen !== pg.gen) return;
      pg.after = r.endCursor; setMore(r.hasNextPage); setItems((old) => (reset ? r.assets : [...old, ...r.assets]));
    } finally { if (gen === pg.gen) pg.loading = false; }
  }
  useEffect(() => {
    if (!want) return;
    setItems([]); setMore(true); void load(true);
  }, [want, album]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!want) return;
    void MediaLibrary.getPermissionsAsync(false, ["photo", "video"]).then((p) => setLimited(p.accessPrivileges === "limited"));
    // the phone's folders with something in them, the biggest first
    void MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true }).then((list) => setAlbums(list.filter((a) => a.assetCount > 0).sort((a, b) => b.assetCount - a.assetCount).map((a) => ({ id: a.id, title: a.title, count: a.assetCount })))).catch(() => setAlbums([]));
  }, [want]);

  const close = (out: Asset[] | null) => { done?.(out); setWant(null); setDone(null); setItems([]); };
  const limit = want?.limit ?? 30;
  const tap = useCallback((a: MediaLibrary.Asset) => setPicked((p) => (p.some((x) => x.id === a.id) ? p.filter((x) => x.id !== a.id) : p.length < limit ? [...p, a] : p)), [limit]);
  async function finish() { setBusy(true); try { close(await Promise.all(picked.map(asAsset))); } finally { setBusy(false); } }
  async function files() { const w = want!, got = await filePick({ ...w, limit: w.limit - picked.length }).catch(() => null); if (got) close([...(await Promise.all(picked.map(asAsset))), ...got]); }
  const cell = (width - GAP * 2) / 3, row = cell + GAP;
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-h-[52px] flex-grow-0" contentContainerClassName="items-center gap-2 px-3 py-2.5">
          <Pressable onPress={() => void files()} className="flex-row items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5">
            <Icon name="upload" size={14} color="accent" /><Text className="text-[12.5px] font-semibold text-foreground">{words("Files")}</Text>
          </Pressable>
          <Chip on={!album} label={words("All")} onPress={() => setAlbum(undefined)} />
          {albums.map((a) => <Chip key={a.id} on={album === a.id} label={`${a.title} · ${a.count}`} onPress={() => setAlbum(a.id)} />)}
        </ScrollView>
        {limited && (
          <Pressable onPress={() => void MediaLibrary.presentPermissionsPickerAsync().then(() => load(true))} className="flex-row items-center gap-2 bg-accent/10 px-4 py-2.5">
            <Icon name="bulb" size={15} color="accent" />
            <Text className="flex-1 text-[12px] text-foreground">{words("Shubix sees only some of your videos. Tap to choose more.")}</Text>
          </Pressable>
        )}
        <FlatList data={items} keyExtractor={(a) => a.id} numColumns={3} columnWrapperStyle={{ gap: GAP }} contentContainerStyle={{ gap: GAP }}
          getItemLayout={(_, i) => ({ length: row, offset: row * i, index: i })}
          onEndReached={() => void load()} onEndReachedThreshold={1.5} initialNumToRender={24} maxToRenderPerBatch={18} windowSize={11} removeClippedSubviews
          ListEmptyComponent={<Text className="p-8 text-center text-[13px] text-muted">{words(more ? "Loading…" : "Nothing here yet.")}</Text>}
          extraData={picked} renderItem={({ item }) => <Cell item={item} n={picked.findIndex((x) => x.id === item.id) + 1} size={cell} onTap={tap} />} />
      </View></ThemeLayer>
    </Modal>
  );
}
