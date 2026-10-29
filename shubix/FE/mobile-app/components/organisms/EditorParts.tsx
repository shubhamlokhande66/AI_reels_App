import { useEffect, useRef, type ReactNode } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEventListener } from "expo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStudioText } from "@shubix/hooks";
import { Button, Glyph, Icon, IconButton, ThemeLayer } from "@shubix/ui-mobile";
import { DOCK_CATEGORIES_DEF, PANEL_NOTE, SHOT_TOOLS_DEF } from "@shubix/core/lib/editor-tools";
import { clipDuration, type ProjectClip } from "@shubix/validations";

/** The website's phone editor (FE/web-app/components/studio/markup.ts and views.ts), drawn natively: the studio's top
 * bar, the preview with its transport, the timeline's tracks (video, text, voice, music), the selected clip's tools
 * and the tools' row; a tool opens its sheet from the bottom. app/editor.tsx keeps the Reel and does the edits. */

// the clips' colours on the timeline (the engine's strip)
const CLIP_COL = ["#6b5540", "#46596a", "#5a4766", "#476452", "#6e4a44", "#5f5a3c", "#3f5d63", "#6a5a2e"];
export const mmss = (t: number, tenth = true) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 9.95 ? "0" : ""}${s.toFixed(tenth ? 1 : 0)}`; };

/** The studio's top bar: its sign, REEL STUDIO with the saved dot, the Reel's name, and Export. */
export function StudioBar({ title, saved, onBack, onExport }: { title: string; saved: boolean; onBack: () => void; onExport: () => void }) {
  const words = useStudioText();
  return (
    <View className="mx-4 mb-3 mt-2 min-h-[58px] flex-row items-center gap-3 rounded-[18px] border border-border bg-surface px-3">
      <IconButton icon="back" label={words("Back")} size={36} look="plain" onPress={onBack} />
      <View className="h-[34px] w-[34px] items-center justify-center rounded-[11px] border border-accent/30 bg-accent/10"><Glyph name="Shots" size={18} color="accent" /></View>
      <View className="min-w-0 flex-1 gap-[3px]">
        <View className="flex-row items-center gap-1.5"><Text className="text-[8px] font-bold tracking-[1px] text-muted">REEL STUDIO</Text><View className={`h-1.5 w-1.5 rounded-full ${saved ? "bg-[#72bd91]" : "bg-border"}`} /><Text numberOfLines={1} className="text-[8px] font-bold tracking-[1px] text-muted">{words(saved ? "SAVED REEL" : "SAVING…")}</Text></View>
        <Text numberOfLines={1} className="text-[13px] text-foreground">{title}</Text>
      </View>
      <Button size="sm" title={words("Export")} iconAfter="arrow" onPress={onExport} />
    </View>
  );
}

/** The preview: the shot under the playhead (a video plays; a photo stays), the big play button over it while still,
 * which shot it is (01 / 08). `onEnded`: the shot played to its end. */
export function Preview({ clip, n, of, playing, aspect, onToggle, onTime, onEnded }: { clip?: ProjectClip; n: number; of: number; playing: boolean; aspect: number; onToggle: () => void; onTime: (t: number) => void; onEnded: () => void }) {
  const words = useStudioText(), video = clip?.kind === "video" ? clip : undefined;
  const player = useVideoPlayer(video?.uri ?? null, (p) => { p.timeUpdateEventInterval = 0.1; p.muted = false; });
  useEffect(() => { if (video) { player.currentTime = video.start; player.playbackRate = video.speed; player.muted = video.muted; player.volume = video.volume; } }, [video, player]);
  useEffect(() => { if (playing && video) player.play(); else player.pause(); }, [playing, video, player]);
  useEventListener(player, "timeUpdate", ({ currentTime }) => { if (!video) return; onTime(Math.max(0, currentTime - video.start) / video.speed); if (currentTime >= video.end - 0.05) onEnded(); });
  // a photo: its seconds pass while playing
  const photoAt = useRef(0);
  useEffect(() => {
    if (!playing || !clip || clip.kind !== "image") return;
    const len = clipDuration(clip), t0 = Date.now() - photoAt.current * 1000;
    const tick = setInterval(() => { photoAt.current = (Date.now() - t0) / 1000; onTime(photoAt.current); if (photoAt.current >= len) { photoAt.current = 0; onEnded(); } }, 100);
    return () => clearInterval(tick);
  }, [playing, clip, onTime, onEnded]);
  const flip = clip ? [{ rotate: `${clip.rotation}deg` }, { scaleX: clip.mirror ? -1 : 1 }, { scaleY: clip.flip ? -1 : 1 }] : [];
  return (
    <View className="gap-2 px-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5"><View className="h-1.5 w-1.5 rounded-full bg-danger" /><Text className="text-[10px] font-bold tracking-[1.2px] text-muted">{words("PREVIEW")}</Text></View>
      </View>
      <Pressable onPress={onToggle} accessibilityLabel={words(playing ? "Pause" : "Play preview")} className="self-center overflow-hidden rounded-[18px] border border-border bg-black" style={{ height: 380, aspectRatio: aspect }}>
        {clip?.kind === "image" && <Image source={{ uri: clip.uri }} resizeMode={clip.fit} className="h-full w-full" style={{ transform: flip }} />}
        {video && <VideoView player={player} contentFit={video.fit} nativeControls={false} style={{ flex: 1, transform: flip }} />}
        {!playing && <View className="absolute inset-0 items-center justify-center"><View className="h-[62px] w-[62px] items-center justify-center rounded-full border-2 border-white/75 bg-black/35"><Icon name="play" size={26} color="#fff" /></View></View>}
        <View className="absolute bottom-2.5 right-2.5 rounded-full bg-black/55 px-2 py-0.5"><Text className="text-[10px] font-semibold text-white">{String(n + 1).padStart(2, "0")} / {String(of).padStart(2, "0")}</Text></View>
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

const PX = 34; // a second on the timeline
const Head = ({ glyph, name, onAdd }: { glyph: string; name: string; onAdd?: () => void }) => {
  const words = useStudioText();
  return (
    <View className="h-full w-[104px] flex-row items-center gap-1.5 border-r border-border pr-1.5">
      <Glyph name={glyph} size={15} color="muted" /><Text numberOfLines={1} className="flex-1 text-[11px] font-semibold text-foreground">{words(name)}</Text>
      {onAdd && <Pressable onPress={onAdd} accessibilityLabel={words("Add")} hitSlop={6} className="h-6 w-6 items-center justify-center rounded-full bg-surface-2"><Icon name="plus" size={13} /></Pressable>}
    </View>
  );
};
const Lane = ({ children, h = 44 }: { children: ReactNode; h?: number }) => <View className="flex-row items-center gap-2" style={{ height: h }}>{children}</View>;

/** The timeline: its head (clips and layers, the time), then the tracks with their heads: the clips (the selected one
 * in gold), the texts, the voice and the song; the playhead at the time. */
export function Timeline({ clips, selected, overlays, song, now, onSelect, onAddClip, onText, onVoice, onMusic }: { clips: ProjectClip[]; selected: number; overlays: { id: string; text: string; start: number; end: number }[]; song?: string; now: number; onSelect: (i: number) => void; onAddClip: () => void; onText: () => void; onVoice: () => void; onMusic: () => void }) {
  const words = useStudioText(), total = clips.reduce((t, c) => t + clipDuration(c), 0), layers = 2 + (overlays.length ? 1 : 0) + (song ? 1 : 0);
  return (
    <View className="mx-4 mt-3 overflow-hidden rounded-[18px] border border-border bg-surface">
      <View className="flex-row items-center gap-2.5 border-b border-border px-3.5 py-3">
        <View className="h-8 w-8 items-center justify-center rounded-[10px] bg-accent/10"><Glyph name="Shots" size={16} color="accent" /></View>
        <View className="flex-1"><Text className="text-[14px] font-semibold text-foreground">{words("Timeline")}</Text><Text className="text-[11px] text-muted">{clips.length} {words(clips.length === 1 ? "clip" : "clips")} · {layers} {words("layers")}</Text></View>
        <Text className="text-[11px] font-semibold text-muted">{mmss(now)} / {mmss(total)}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-3 py-3">
        <View className="gap-1.5">
          <Lane h={52}><Head glyph="Media" name="Video" onAdd={onAddClip} />
            <View className="flex-row gap-[3px]">{clips.map((c, i) => (
              <Pressable key={c.id} onPress={() => onSelect(i)} accessibilityLabel={`${words("Shot")} ${i + 1}`} className={`h-[52px] justify-end overflow-hidden rounded-lg p-1.5 ${i === selected ? "border-2 border-accent" : ""}`} style={{ width: Math.max(44, clipDuration(c) * PX), backgroundColor: CLIP_COL[i % CLIP_COL.length] }}>
                {c.kind === "image" && <Image source={{ uri: c.uri }} className="absolute inset-0 h-full w-full opacity-60" />}
                <Text numberOfLines={1} className="text-[9px] font-semibold text-white">{clipDuration(c).toFixed(1)}s{c.speed !== 1 ? ` · ${c.speed}×` : ""}</Text>
              </Pressable>
            ))}</View>
          </Lane>
          <Lane><Head glyph="Text" name="Text" onAdd={onText} />
            <Pressable onPress={onText} className="h-8 min-w-[90px] flex-row items-center gap-1 rounded-md border border-[#665276] bg-[#5a4766]/40 px-2">{overlays.length ? overlays.map((o) => <Text key={o.id} numberOfLines={1} className="text-[10px] text-foreground">{o.text}</Text>) : <Text className="text-[10px] text-muted">+ {words("Add text")}</Text>}</Pressable>
          </Lane>
          <Lane><Head glyph="Voice" name="Voice" onAdd={onVoice} /><Pressable onPress={onVoice} className="h-8 min-w-[90px] justify-center rounded-md border border-dashed border-border px-2"><Text className="text-[10px] text-muted">+ {words("Voiceover")}</Text></Pressable></Lane>
          <Lane><Head glyph="Music" name="Music" onAdd={onMusic} />
            <Pressable onPress={onMusic} className="h-8 flex-row items-center gap-[2px] overflow-hidden rounded-md border border-[#476452] bg-[#476452]/40 px-2" style={{ width: Math.max(160, total * PX) }}>
              {song ? <><Glyph name="Music" size={12} color="#9fc2a6" /><Text numberOfLines={1} className="text-[10px] text-foreground">{song}</Text></> : <Text className="text-[10px] text-muted">+ {words("Add music")}</Text>}
            </Pressable>
          </Lane>
          <View pointerEvents="none" className="absolute bottom-0 top-0 w-0.5 bg-accent" style={{ left: 104 + 8 + Math.min(now, total) * PX }} />
        </View>
      </ScrollView>
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
export function Choices({ items, on, onPick }: { items: string[]; on?: string; onPick: (v: string) => void }) {
  const words = useStudioText();
  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((x) => (
        <Pressable key={x} onPress={() => onPick(x)} accessibilityRole="button" accessibilityState={{ selected: on === x }} className={`min-h-10 justify-center rounded-xl border px-3.5 ${on === x ? "border-accent bg-accent/10" : "border-border bg-surface-2"}`}>
          <Text className={`text-[12.5px] font-semibold ${on === x ? "text-accent" : "text-foreground"}`}>{words(x)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
