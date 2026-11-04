import { memo, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useStudioText } from "@mobile/hooks";
import { Button, Glyph, Icon, IconButton, ThemeLayer } from "@mobile/ui-mobile";
import { DOCK_CATEGORIES_DEF, PANEL_NOTE, SHOT_TOOLS_DEF } from "@mobile/core/lib/editor-tools";
import { clipDuration, type ProjectClip, type ReelProject } from "@mobile/validations";
import { buildSpeedRampSegments, type SpeedRampSegment } from "@mobile/video-engine";
import { useThumb } from "../../lib/thumbs";

/** The website's phone editor (FE/web-app/components/studio/markup.ts and views.ts), drawn natively: the studio's top
 * bar, the preview with its transport, the timeline's tracks (video, text, voice, music), the selected clip's tools
 * and the tools' row; a tool opens its sheet from the bottom. app/editor.tsx keeps the Reel and does the edits. */

// the clips' colours on the timeline (the engine's strip)
const CLIP_COL = ["#6b5540", "#46596a", "#5a4766", "#476452", "#6e4a44", "#5f5a3c", "#3f5d63", "#6a5a2e"];
export const mmss = (t: number, tenth = true) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 9.95 ? "0" : ""}${s.toFixed(tenth ? 1 : 0)}`; };

/** The studio's top bar: its sign, the Reel's name, and Export. */
export function StudioBar({ title, onBack, onExport }: { title: string; onBack: () => void; onExport: () => void }) {
  const words = useStudioText();
  return (
    <View className="mx-4 mb-3 mt-2 min-h-[58px] flex-row items-center gap-3 rounded-[18px] border border-border bg-surface px-3">
      <IconButton icon="back" label={words("Back")} size={36} look="plain" onPress={onBack} />
      <View className="h-[34px] w-[34px] items-center justify-center rounded-[11px] border border-accent/30 bg-accent/10"><Glyph name="Shots" size={18} color="accent" /></View>
      <View className="min-w-0 flex-1 gap-[3px]">
        <Text numberOfLines={1} className="text-[13px] text-foreground">{title}</Text>
      </View>
      <View><Button title={words("Export")} iconAfter="arrow" onPress={onExport} /></View>
    </View>
  );
}

/** Map timeline time to source time using the same constant-rate slices used by native export. */
function rampTimelineAt(segments: SpeedRampSegment[], sourceTime: number) {
  const t = Math.max(0, sourceTime);
  const segment = segments.find((item) => t <= item.sourceEnd + 0.0001) ?? segments[segments.length - 1];
  return segment ? Math.min(segment.outputEnd, segment.outputStart + Math.max(0, t - segment.sourceStart) / segment.speed) : t;
}

/** The preview box: the editor's one player inside it, the big play button over it while paused, which shot it is (01 / 08). */
export function Preview({ n, of, playing, aspect, error, onToggle, children }: { n: number; of: number; playing: boolean; aspect: number; error?: string | null; onToggle: () => void; children: ReactNode }) {
  const words = useStudioText(), screen = useWindowDimensions();
  // the Reel is what the person came to check: as wide as the screen, as tall as most of it
  const width = Math.min(screen.width - 32, screen.height * 0.68 * aspect);
  return (
    <View className="gap-2 px-4">
      <View className="flex-row items-center gap-1.5"><View className="h-1.5 w-1.5 rounded-full bg-danger" /><Text className="text-[10px] font-bold tracking-[1.2px] text-muted">{words("PREVIEW")}</Text></View>
      <Pressable onPress={onToggle} accessibilityLabel={words(playing ? "Pause" : "Play preview")} className="self-center overflow-hidden rounded-[18px] border border-border bg-black" style={{ width, aspectRatio: aspect }}>
        {children}
        {error ? <View pointerEvents="none" className="absolute inset-0 items-center justify-center bg-black/70 px-4"><Text className="text-center text-[12px] font-semibold text-white">{error}</Text></View>
          : !playing && <View pointerEvents="none" className="absolute inset-0 items-center justify-center"><View className="h-[62px] w-[62px] items-center justify-center rounded-full border-2 border-white/75 bg-black/35"><Icon name="play" size={26} color="#fff" /></View></View>}
        <View pointerEvents="none" className="absolute bottom-2.5 right-2.5 rounded-full bg-black/55 px-2 py-0.5"><Text className="text-[10px] font-semibold text-white">{String(n + 1).padStart(2, "0")} / {String(of).padStart(2, "0")}</Text></View>
      </Pressable>
    </View>
  );
}

/** The transport: the time, the shot before, play, the shot after, the sound, and the progress line. */
export function Transport({ now, total, playing, sound, onPrev, onToggle, onNext, onSound }: { now: number; total: number; playing: boolean; sound: boolean; onPrev: () => void; onToggle: () => void; onNext: () => void; onSound: () => void }) {
  const words = useStudioText();
  return (
    <View className="mt-2 gap-2 px-4">
      <View className="flex-row items-center gap-1.5">
        <Text className="text-[12px] font-semibold text-foreground">{mmss(now)}</Text><Text className="text-[12px] text-muted">/ {mmss(total)}</Text>
        <View className="flex-1" />
        <IconButton icon="prev" label={words("Previous shot")} size={40} onPress={onPrev} />
        <IconButton icon={playing ? "pause" : "play"} label={words(playing ? "Pause" : "Play preview")} size={44} look="main" onPress={onToggle} className="overflow-hidden" />
        <IconButton icon="next" label={words("Next shot")} size={40} onPress={onNext} />
        <View className="flex-1" />
        <Pressable onPress={onSound} accessibilityRole="switch" accessibilityState={{ checked: sound }} className="flex-row items-center gap-1 rounded-full border border-border px-2 py-1">
          <Glyph name="Music" size={13} color={sound ? "accent" : "muted"} /><Text className={`text-[9px] font-bold tracking-[0.8px] ${sound ? "text-accent" : "text-muted"}`}>{words(sound ? "SOUND ON" : "SOUND OFF")}</Text>
        </Pressable>
      </View>
      <View className="h-1 overflow-hidden rounded-full bg-surface-2"><View className="h-full rounded-full bg-accent" style={{ width: `${total ? Math.min(100, (now / total) * 100) : 0}%` }} /></View>
    </View>
  );
}

const HEAD = 104; // the tracks' heads
const Head = ({ glyph, name, h, onAdd }: { glyph: string; name: string; h: number; onAdd?: () => void }) => {
  const words = useStudioText();
  return (
    <View className="flex-row items-center gap-1.5 pr-1.5" style={{ height: h }}>
      <Glyph name={glyph} size={15} color="muted" /><Text numberOfLines={1} className="flex-1 text-[11px] font-semibold text-foreground">{words(name)}</Text>
      {onAdd && <Pressable onPress={onAdd} accessibilityLabel={words("Add")} hitSlop={6} className="h-6 w-6 items-center justify-center rounded-full bg-surface-2"><Icon name="plus" size={13} /></Pressable>}
    </View>
  );
};
const LANES: [string, string, number][] = [["Media", "Video", 52], ["Text", "Text", 36], ["Voice", "Voice", 36], ["Music", "Music", 36]];
// a clip's picture, drawn once (the timeline redraws on every frame of a zoom)
const ClipPicture = memo(function ClipPicture({ uri, kind }: { uri: string; kind: ProjectClip["kind"] }) { const t = useThumb(uri, kind); return t ? <Image source={{ uri: t }} className="h-full w-full" resizeMode="cover" /> : null; });
const ZoomButton = ({ label, text, onPress }: { label: string; text: string; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityLabel={label} className="h-8 min-w-8 items-center justify-center rounded-lg border border-border px-1.5"><Text className="text-[13px] font-bold text-foreground">{text}</Text></Pressable>
);


/** A clip block with independent left/right trim gestures. */
function TimelineClip({ clip, index, selected, width, px, onSelect, onTrim, onMove }: {
  clip: ProjectClip; index: number; selected: boolean; width: number; px: number;
  onSelect: () => void; onTrim: (edge: "start" | "end", deltaSeconds: number) => void; onMove: (deltaSeconds: number) => void;
}) {
  const words = useStudioText();
  const moveGesture = Gesture.Pan().activateAfterLongPress(250).runOnJS(true).onEnd((event) => {
    if (Math.abs(event.translationX) >= 8) onMove(event.translationX / Math.max(1, px));
  });
  const trimGesture = (edge: "start" | "end") => Gesture.Pan()
    .runOnJS(true)
    .onEnd((event) => {
      if (Math.abs(event.translationX) >= 3) onTrim(edge, event.translationX / Math.max(1, px));
    });
  return (
    <View className={`mr-[2px] h-[52px] overflow-hidden rounded-lg ${selected ? "border-2 border-accent" : ""}`} style={{ width: Math.max(24, width), backgroundColor: CLIP_COL[index % CLIP_COL.length] }}>
      <GestureDetector gesture={moveGesture}>
        <Pressable onPress={onSelect} accessibilityLabel={`${words("Shot")} ${index + 1}`} className="absolute inset-0 justify-end">
          <View className="absolute inset-0 opacity-70"><ClipPicture uri={clip.uri} kind={clip.kind} /></View>
          <Text numberOfLines={1} className="px-1.5 pb-1 text-[9px] font-semibold text-white">{clipDuration(clip).toFixed(1)}s{clip.speed !== 1 ? ` · ${clip.speed}×` : ""}</Text>
        </Pressable>
      </GestureDetector>
      <GestureDetector gesture={trimGesture("start")}>
        <View accessibilityLabel={words("Trim start")} className="absolute bottom-0 left-0 top-0 w-3 border-r-2 border-white/90 bg-black/35" />
      </GestureDetector>
      <GestureDetector gesture={trimGesture("end")}>
        <View accessibilityLabel={words("Trim end")} className="absolute bottom-0 right-0 top-0 w-3 border-l-2 border-white/90 bg-black/35" />
      </GestureDetector>
    </View>
  );
}

/** The timeline (the website's phone timeline, as VN): its head (the time, clips and layers, zoom − / + and Fit), the
 * tracks' heads, and the tracks sliding under the playhead in the middle: playing moves them, a swipe scrubs (`onSeek`),
 * two fingers or − / + zoom. A tap on a clip selects it. */
export function Timeline({ clips, selected, overlays, studioLayers = [], song, now, playing, onSelect, onSeek, onTrim, onMove, onAddClip, onText, onVoice, onMusic, onLayer }: { clips: ProjectClip[]; selected: number; overlays: { id: string; text: string; start: number; end: number }[]; studioLayers?: { index: number; t0: number; t1: number }[]; song?: string; now: number; playing: boolean; onSelect: (i: number) => void; onSeek: (t: number) => void; onTrim: (i: number, edge: "start" | "end", deltaSeconds: number) => void; onMove: (i: number, deltaSeconds: number) => void; onAddClip: () => void; onText: () => void; onVoice: () => void; onMusic: () => void; onLayer?: (index: number) => void }) {
  const words = useStudioText(), total = clips.reduce((t, c) => t + clipDuration(c), 0), laneDefs = [...LANES, ...(studioLayers.length ? [["Layers", "Layers", 36] as [string, string, number]] : [])];
  const [px, setPx] = useState(34), [view, setView] = useState(240), [snapEnabled, setSnapEnabled] = useState(true), scroller = useRef<ComponentRef<typeof ScrollView>>(null), dragging = useRef(false), pinchFrom = useRef(34);
  const clamp = (to: number) => Math.max(8, Math.min(160, to)), frame = useRef(0), want = useRef(34);
  // zooming follows the fingers once a frame, and − / + / Fit glide there over a few frames
  const zoom = (to: number, glide = false) => {
    want.current = clamp(to); cancelAnimationFrame(frame.current);
    const step = () => setPx((x) => { const next = glide ? x + (want.current - x) * 0.35 : want.current; if (Math.abs(next - want.current) > 0.3) frame.current = requestAnimationFrame(step); return Math.abs(next - want.current) > 0.3 ? next : want.current; });
    frame.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // the Reel follows the playhead while it plays, and when the time changes from elsewhere
  useEffect(() => { if (!dragging.current) scroller.current?.scrollTo({ x: now * px, animated: false }); }, [now, px]);
  const snapTime = (time: number) => {
    if (!snapEnabled) return time;
    let cursor = 0, nearest = time, distance = Math.max(0.06, 10 / px);
    for (const item of clips) {
      const end = cursor + clipDuration(item);
      for (const edge of [cursor, end]) { const delta = Math.abs(edge - time); if (delta < distance) { distance = delta; nearest = edge; } }
      cursor = end;
    }
    return nearest;
  };
  const pinch = Gesture.Pinch().runOnJS(true).onStart(() => { pinchFrom.current = px; }).onUpdate((e) => zoom(pinchFrom.current * e.scale));
  return (
    <View className="mx-4 mt-3 overflow-hidden rounded-[18px] border border-border bg-surface">
      <View className="flex-row items-center gap-1.5 border-b border-border px-3 py-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-[10px] bg-accent/10"><Glyph name="Shots" size={16} color="accent" /></View>
        <View className="min-w-0 flex-1"><Text className="text-[14px] font-semibold text-foreground">{words("Timeline")}</Text><Text numberOfLines={1} className="text-[11px] text-muted">{mmss(now)} / {mmss(total)} · {clips.length} {words(clips.length === 1 ? "clip" : "clips")}</Text></View>
        <ZoomButton label={words("Zoom out")} text="−" onPress={() => zoom(px / 1.5, true)} />
        <Text className="w-10 text-center text-[11px] font-semibold text-muted">{Math.round((px / 34) * 100)}%</Text>
        <ZoomButton label={words("Zoom in")} text="+" onPress={() => zoom(px * 1.5, true)} />
        <ZoomButton label={words("Toggle snapping")} text={snapEnabled ? "Snap ✓" : "Snap"} onPress={() => setSnapEnabled((value) => !value)} />
        <ZoomButton label={words("Fit")} text={words("Fit")} onPress={() => { if (total) zoom((view - 24) / total, true); }} />
      </View>
      <View className="flex-row py-2.5 pl-3">
        <View style={{ width: HEAD }} className="gap-1.5 border-r border-border">{laneDefs.map(([g, n, h], i) => <Head key={n} glyph={g} name={n} h={h} onAdd={[onAddClip, onText, onVoice, onMusic, () => onLayer?.(studioLayers[0]?.index ?? 0)][i]} />)}</View>
        <GestureDetector gesture={pinch}>
          <View className="flex-1" onLayout={(e) => setView(e.nativeEvent.layout.width)}>
            <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: view / 2 }}
              onScrollBeginDrag={() => { dragging.current = true; }} onMomentumScrollEnd={() => { dragging.current = false; }}
              onScrollEndDrag={(e) => { if (!e.nativeEvent.velocity?.x) dragging.current = false; }}
              onScroll={(e) => { if (dragging.current && !playing) onSeek(snapTime(Math.max(0, Math.min(total, e.nativeEvent.contentOffset.x / px)))); }}>
              <View className="gap-1.5">
                <View className="h-[52px] flex-row">{clips.map((c, i) => (
                  <TimelineClip key={c.id} clip={c} index={i} selected={i === selected}
                    width={Math.max(24, clipDuration(c) * px - 2)} px={px} onSelect={() => onSelect(i)}
                    onTrim={(edge, delta) => onTrim(i, edge, delta)} onMove={(delta) => onMove(i, delta)} />
                ))}</View>
                <View className="h-9" style={{ width: total * px }}>{overlays.length ? overlays.map((o) => (
                  <Pressable key={o.id} onPress={onText} className="absolute h-8 justify-center overflow-hidden rounded-md border border-[#665276] bg-[#5a4766]/50 px-1.5" style={{ left: o.start * px, width: Math.max(24, (o.end - o.start) * px) }}><Text numberOfLines={1} className="text-[10px] text-foreground">{o.text}</Text></Pressable>
                )) : <Pressable onPress={onText} className="h-8 w-[110px] justify-center rounded-md border border-dashed border-border px-2"><Text className="text-[10px] text-muted">+ {words("Add text")}</Text></Pressable>}</View>
                <View className="h-9"><Pressable onPress={onVoice} className="h-8 w-[110px] justify-center rounded-md border border-dashed border-border px-2"><Text className="text-[10px] text-muted">+ {words("Voiceover")}</Text></Pressable></View>
                {studioLayers.length > 0 && <View className="h-9" style={{ width: total * px }}>{studioLayers.map((layer) => (
                  <Pressable key={layer.index} onPress={() => onLayer?.(layer.index)} className="absolute h-8 justify-center overflow-hidden rounded-md border border-[#8a6b36] bg-[#8a6b36]/40 px-1.5" style={{ left: Math.max(0, layer.t0) * px, width: Math.max(24, (Math.max(layer.t0 + 0.25, layer.t1) - layer.t0) * px) }}>
                    <Text numberOfLines={1} className="text-[10px] text-foreground">{words("Overlay")} {layer.index + 1}</Text>
                  </Pressable>
                ))}</View>}
                <View className="h-9"><Pressable onPress={onMusic} className="h-8 flex-row items-center gap-1 overflow-hidden rounded-md border border-[#476452] bg-[#476452]/40 px-2" style={{ width: Math.max(110, total * px) }}>
                  {song ? <><Glyph name="Music" size={12} color="#9fc2a6" /><Text numberOfLines={1} className="text-[10px] text-foreground">{song}</Text></> : <Text className="text-[10px] text-muted">+ {words("Add music")}</Text>}
                </Pressable></View>
              </View>
            </ScrollView>
            <View pointerEvents="none" className="absolute bottom-0 top-0 w-0.5 bg-accent" style={{ left: view / 2 - 1 }}><View className="-ml-[4px] h-2.5 w-2.5 rounded-full bg-accent" /></View>
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

/** A row of tool tiles (the clip's tools, or the tools' row): the sign over the name; a plan's tool its plan's tag. */
export function ToolRow({ items, on, onPress }: { items: { key: string; name: string; tag?: string; danger?: boolean }[]; on?: string; onPress: (key: string) => void }) {
  const words = useStudioText();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4 py-1">
      {items.map((t) => (
        <Pressable key={t.key} onPress={() => onPress(t.key)} accessibilityRole="button" accessibilityState={{ selected: on === t.key }} className={`min-h-[60px] min-w-[62px] items-center justify-center gap-1 rounded-[14px] border px-2.5 ${on === t.key ? "border-accent bg-accent/10" : "border-border bg-surface"}`}>
          <Glyph name={t.name} size={18} color={t.danger ? "danger" : on === t.key ? "accent" : "foreground"} />
          <Text className={`text-[11px] font-semibold ${t.danger ? "text-danger" : "text-foreground"}`}>{words(t.name)}</Text>
          {t.tag ? <View className="absolute -right-1 -top-1.5 rounded-full bg-accent px-1.5"><Text className="text-[8px] font-extrabold text-on-accent">{t.tag}</Text></View> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}
export const SHOT_TOOLS = SHOT_TOOLS_DEF.map(([name, act]) => ({ key: act, name, danger: name === "Delete" }));
export const DOCK = DOCK_CATEGORIES_DEF.map(([key, name]) => ({ key, name }));

/** A tool's sheet from the bottom (the website's sheets): its sign in a square, EDITOR TOOL over its name, what it is
 * for, its content, then Done. */
export function ToolSheet({ tool, onClose, children }: { tool: { key: string; name: string } | null; onClose: () => void; children: ReactNode }) {
  const words = useStudioText(), insets = useSafeAreaInsets();
  return (
    <Modal visible={!!tool} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <ThemeLayer className="justify-end bg-black/50">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel={words("Close")} />
        <View className="max-h-[72%] gap-3 rounded-t-[24px] border border-border bg-surface px-4 pt-3" style={{ paddingBottom: 14 + insets.bottom }}>
          <View className="h-1 w-10 self-center rounded-full bg-border" />
          {tool && (
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-accent/10"><Glyph name={tool.name} size={18} color="accent" /></View>
              <View className="flex-1"><Text className="text-[9px] font-bold tracking-[1.2px] text-muted">{words("EDITOR TOOL")}</Text><Text className="text-[16px] font-semibold text-foreground">{words(tool.name)}</Text></View>
              <IconButton icon="close" label={words("Close")} size={36} onPress={onClose} />
            </View>
          )}
          {tool && PANEL_NOTE[tool.key] ? <Text className="text-[12.5px] leading-[18px] text-muted">{words(PANEL_NOTE[tool.key])}</Text> : null}
          <ScrollView contentContainerClassName="gap-3 pb-1" keyboardShouldPersistTaps="handled">{children}</ScrollView>
          <Button full size="lg" icon="check" title={words("Done")} onPress={onClose} />
        </View>
      </ThemeLayer>
    </Modal>
  );
}

/** A sheet's choices as chips (the one in use in gold). */
export function Choices({ items, on, onPick, disabledItems = [] }: { items: string[]; on?: string; onPick: (v: string) => void; disabledItems?: readonly string[] }) {
  const words = useStudioText();
  const disabled = new Set(disabledItems);
  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((x) => {
        const unavailable = disabled.has(x);
        return (
          <Pressable key={x} disabled={unavailable} onPress={() => onPick(x)} accessibilityRole="button" accessibilityState={{ selected: on === x, disabled: unavailable }} className={`min-h-10 justify-center rounded-xl border px-3.5 ${unavailable ? "border-border/50 bg-surface opacity-40" : on === x ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}>
            <Text className={`text-[12.5px] font-semibold ${unavailable ? "text-muted" : on === x ? "text-accent" : "text-foreground"}`}>{words(x)}{unavailable ? " · Soon" : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
