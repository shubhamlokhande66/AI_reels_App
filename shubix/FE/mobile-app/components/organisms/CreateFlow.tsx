import { useEffect, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import type { ImagePickerAsset } from "expo-image-picker";
import { useStudioText } from "@shubix/hooks";
import { Button, Gold, Icon, IconButton, Input, Segmented, useColors } from "@shubix/ui-mobile";
import type { IconName } from "@shubix/ui-core";
import { clock } from "@shubix/utils";
import { forgetSong, type Song } from "../../lib/songs";
import { useThumb } from "../../lib/thumbs";

/** The website's phone Create flow (FE/web-app/components/studio/flow.ts and markup.ts), one screen at a time: the
 * intro, Choose Music, Adjust Music, Add Your Clips and Analysing. The words are the studio's (Admin → CMS → Create
 * flow); app/create/[kind].tsx keeps the state and moves between the screens. */
/** A clip's picture: a photo, or a frame of the video (a dark tile with the video sign while it is made). */
export function Thumb({ uri, kind }: { uri: string; kind: "video" | "image" }) {
  const t = useThumb(uri, kind);
  return t ? <Image source={{ uri: t }} className="h-full w-full" resizeMode="cover" /> : <View className="flex-1 items-center justify-center bg-black/80"><Icon name="video" size={22} color="#fff" /></View>;
}

export type FlowKind = "music" | "talking" | "photo" | "copy";
export type FlowStep = "intro" | "choose" | "adjust" | "clips" | "analyse";

export const KINDS: Record<FlowKind, { title: string; sub: string; intro: string; checks: string[]; icon: IconName }> = {
  music: { title: "Music Reel", sub: "Turn your clips into a stunning Reel with music, beats and Shubix edits.", intro: "Create a Music Reel", checks: ["Pick a song", "Add your videos or photos", "Shubix edits on the beat", "Preview, make changes and export"], icon: "music" },
  talking: { title: "Talking Reel", sub: "Your talking video, pauses cut, captions added, music under the voice.", intro: "Create a Talking Reel", checks: ["Add your talking video", "Pauses cut, captions added", "Soft music under the voice", "Preview, make changes and export"], icon: "mic" },
  photo: { title: "Photo Reel", sub: "Your photos, moving to the music, cut on the beat.", intro: "Create a Photo Reel", checks: ["Pick a song", "Add your photos", "Shubix moves them on the beat", "Preview, make changes and export"], icon: "image" },
  copy: { title: "Copy a Reel", sub: "Match a Reel you like: its cuts, texts and look on your clips.", intro: "Copy a Reel", checks: ["Pick the Reel to copy (its song comes with it)", "Add your clips", "Shubix copies its cuts and look", "Preview, make changes and export"], icon: "copy" },
};
export const ORDER: Record<FlowKind, FlowStep[]> = { music: ["intro", "choose", "adjust", "clips", "analyse"], photo: ["intro", "choose", "adjust", "clips", "analyse"], copy: ["intro", "choose", "adjust", "clips", "analyse"], talking: ["intro", "clips", "analyse"] };
export const AI_STEPS: [IconName, string][] = [["search", "Detecting scenes and best moments"], ["music", "Matching with music beats"], ["wand", "Auto transitions and effects"], ["palette", "Colour and quality enhancement"]];
const DOTS = ["Music", "Clips", "Shubix Edit", "Preview & Export"];

/** The flow's card (the studio's flowCard). */
export const FlowCard = ({ children, className = "" }: { children: ReactNode; className?: string }) => <View className={`gap-3.5 rounded-[20px] border border-accent/15 bg-surface px-[18px] py-4 ${className}`}>{children}</View>;
const Label = ({ children }: { children: string }) => <Text className="text-[12px] font-bold uppercase tracking-[1.2px] text-muted">{children}</Text>;

/** The head: back, the screen's name, the four steps (the one you are on gold, the ones done ticked); Skip on the intro. */
export function FlowHead({ title, at, onBack, onSkip }: { title: string; at: number; onBack: () => void; onSkip?: () => void }) {
  const words = useStudioText();
  return (
    <View className="gap-3 bg-background px-4 pb-3 pt-3">
      <View className="min-h-10 flex-row items-center gap-3">
        <IconButton icon="back" label={words("Back")} size={40} onPress={onBack} />
        <Text numberOfLines={1} className="flex-1 text-[17px] font-semibold tracking-[-0.2px] text-foreground">{title}</Text>
        {onSkip ? <Button variant="ghost" size="sm" title={words("Skip")} onPress={onSkip} /> : <View className="w-10" />}
      </View>
      <View accessibilityLabel={words("Steps")} className="w-[190px] flex-row items-center self-center">
        {DOTS.map((name, i) => {
          const n = i + 1, s = n === at ? "on" : n < at ? "ok" : "no";
          return [
            i > 0 && <View key={`l${n}`} className={`h-0.5 flex-1 ${n <= at ? "bg-accent" : "bg-border"}`} />,
            <View key={n} accessibilityLabel={words(name)} className={`h-7 w-7 items-center justify-center overflow-hidden rounded-full border ${s === "on" ? "border-transparent" : s === "ok" ? "border-accent bg-accent/15" : "border-border bg-surface-2"}`}>
              {s === "on" && <Gold />}
              {s === "ok" ? <Icon name="check" size={14} stroke={2.6} color="accent" /> : <Text className={`text-[12px] font-semibold ${s === "on" ? "text-on-accent" : "text-muted"}`}>{n}</Text>}
            </View>,
          ];
        })}
      </View>
    </View>
  );
}

/** The intro: the kind's gold tile, its title and line, and what happens next, ticked. */
export function FlowIntro({ kind }: { kind: FlowKind }) {
  const words = useStudioText(), k = KINDS[kind];
  return (
    <View className="items-center gap-3 px-1 pt-2">
      <View className="rounded-[32px] bg-accent/[0.12] p-2.5">
        <View className="h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-[22px]"><Gold /><Icon name={k.icon} size={44} color="#fff" /></View>
      </View>
      <Text className="mt-1.5 text-center text-[27px] font-semibold tracking-[-0.5px] text-foreground">{words(k.intro)}</Text>
      <Text className="max-w-[300px] text-center text-[14.5px] leading-[22px] text-muted">{words(k.sub)}</Text>
      <View className="mb-1.5 mt-3.5 gap-3 self-stretch px-1.5">
        {k.checks.map((c) => (
          <View key={c} className="flex-row items-center gap-3">
            <View className="h-6 w-6 items-center justify-center rounded-full bg-accent"><Icon name="check" size={15} stroke={3} color="#fff" /></View>
            <Text className="flex-1 text-[15px] font-semibold text-foreground">{words(c)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Choose Music: Choose song (a spinner while it is read), what can be chosen, and the recent songs as cards.
 * Copy a Reel: the Reel to copy instead (its sound is the song), or a different song. */
export function FlowChoose({ kind, song, recent, busy, onPick, onPickReel, onRecent, onForget }: { kind: FlowKind; song: Song | null; recent: Song[]; busy: boolean; onPick: () => void; onPickReel: () => void; onRecent: (s: Song) => void; onForget: (uri: string) => void }) {
  const words = useStudioText();
  return (
    <View className="gap-4">
      {kind === "copy" && (
        <FlowCard>
          <View className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-xl bg-accent/15"><Icon name="copy" size={20} color="accent" /></View>
            <View className="min-w-0 flex-1"><Text className="text-[15px] font-semibold text-foreground">{words("Reel to copy")}</Text><Text className="text-[12.5px] leading-[18px] text-muted">{words("Pick a Reel you like: its song, cuts, transitions and look go on your clips")}</Text></View>
          </View>
          <Button full size="lg" icon="video" loading={busy} title={words("Pick the Reel")} onPress={onPickReel} />
        </FlowCard>
      )}
      <FlowCard>
        <Button full size="lg" icon="music" loading={busy} title={words("Choose song")} onPress={onPick} />
        <Text className="text-[12.5px] leading-[18px] text-muted">{words(kind === "copy" ? "Different song? Choose it here" : "MP3, M4A, WAV or any video's sound (iPhone: from Files or Photos)")}</Text>
        {recent.length > 0 && (
          <View className="gap-2.5">
            <Label>{words("Recent songs")}</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 p-0.5">
              {recent.map((r) => {
                const on = song?.uri === r.uri;
                return (
                  <View key={r.uri} className={`min-h-[96px] w-[150px] overflow-hidden rounded-2xl ${on ? "border-2 border-accent" : "border border-border"}`}>
                    <View className="absolute inset-0 bg-surface-2" /><View className="absolute inset-0 bg-accent/25" />
                    <Pressable onPress={() => onRecent(r)} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: on }} className="flex-1 justify-end gap-0.5 p-3 active:opacity-80">
                      <Text numberOfLines={2} className="text-[14px] font-semibold text-foreground">{r.name}</Text>
                      <Text className="text-[12px] font-medium text-muted">{r.duration ? clock(r.duration) : "—"}</Text>
                    </Pressable>
                    <Pressable onPress={() => { void forgetSong(r.uri); onForget(r.uri); }} accessibilityLabel={words("Remove")} hitSlop={6} className="absolute right-1.5 top-1.5 h-[26px] w-[26px] items-center justify-center rounded-full bg-black/35"><Icon name="close" size={13} color="#fff" /></Pressable>
                    {on && <View className="absolute bottom-2.5 right-2.5 h-6 w-6 items-center justify-center rounded-full bg-accent"><Icon name="check" size={14} stroke={3} color="#fff" /></View>}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
      </FlowCard>
    </View>
  );
}

// the song's bars (the same picture each time for a song: its name decides them)
const bars = (seed: string) => Array.from({ length: 56 }, (_, i) => { let h = 7; for (const c of seed + i) h = (h * 31 + c.charCodeAt(0)) % 997; return 0.25 + (h % 75) / 100; });
export const LENGTHS = [0, 15, 30, 60];

/** Adjust Music: the song in a row, its bars (the part the Reel uses in gold, play to hear it) and the Reel's length. */
export function FlowAdjust({ song, length, onLength }: { song: Song; length: number; onLength: (n: number) => void }) {
  const words = useStudioText(), look = useColors(), player = useAudioPlayer(song.uri), status = useAudioPlayerStatus(player);
  const duration = song.duration || status.duration || 0, used = length && duration ? Math.min(length, duration) / duration : 1;
  const heard = duration ? status.currentTime / duration : 0;
  const [custom, setCustom] = useState(!LENGTHS.includes(length)), [typed, setTyped] = useState(LENGTHS.includes(length) ? 45 : length);
  useEffect(() => () => { try { player.pause(); } catch { /* already gone */ } }, [player]);
  const toggle = () => { if (status.playing) player.pause(); else { if (length && status.currentTime >= Math.min(length, duration)) void player.seekTo(0); player.play(); } };
  useEffect(() => { if (length && status.playing && status.currentTime >= length) player.pause(); }, [length, status.currentTime, status.playing, player]);
  return (
    <FlowCard>
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-xl bg-accent/15"><Icon name="music" size={20} color="accent" /></View>
        <View className="min-w-0 flex-1"><Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">{song.name}</Text><Text className="text-[12.5px] text-muted">{words("Song")} · {duration ? clock(duration) : "—"}</Text></View>
      </View>
      <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface-2 p-3">
        <IconButton icon={status.playing ? "pause" : "play"} look="main" label={words(status.playing ? "Pause" : "Play")} size={40} onPress={toggle} className="overflow-hidden"/>
        <View className="h-[86px] flex-1 flex-row items-center gap-[2px]">
          {bars(song.name).map((h, i, all) => {
            const at = i / all.length;
            return <View key={i} className="flex-1 rounded-full" style={{ height: `${h * 100}%`, backgroundColor: at < used ? look.accent : look.border, opacity: at < heard || at >= used ? 1 : 0.75 }} />;
          })}
          {used < 1 && <View pointerEvents="none" className="absolute bottom-0 left-0 top-0 rounded-lg border-2 border-accent bg-accent/10" style={{ width: `${used * 100}%` }} />}
          {heard > 0 && <View pointerEvents="none" className="absolute bottom-0 top-0 w-0.5 bg-foreground" style={{ left: `${Math.min(heard, 1) * 100}%` }} />}
        </View>
      </View>
      <View className="gap-2.5">
        <Label>{words("Reel length")}</Label>
        <View className="flex-row flex-wrap gap-2">
          {[...LENGTHS, -1].map((n) => {
            const on = n === -1 ? custom : !custom && length === n; // -1: Custom
            return (
              <Pressable key={n} onPress={() => { setCustom(n === -1); onLength(n === -1 ? typed : n); }} accessibilityRole="radio" accessibilityState={{ checked: on }} className={`h-10 items-center justify-center overflow-hidden rounded-xl px-4 ${on ? "" : "border border-border bg-surface-2"}`}>
                {on && <Gold />}
                <Text className={`text-[13px] font-semibold ${on ? "text-on-accent" : "text-foreground"}`}>{words(n === -1 ? "Custom" : n === 0 ? "Full" : n === 60 ? "1 min" : `${n} s`)}</Text>
              </Pressable>
            );
          })}
        </View>
        {custom && <View className="w-[140px]"><Input keyboardType="number-pad" maxLength={3} value={String(typed || "")} accessibilityLabel={words("Reel length")} right={<Text className="text-[13px] text-muted">s</Text>}
          onChangeText={(v) => { const n = Number(v.replace(/\D/g, "")); setTyped(n); if (n >= 5) onLength(Math.min(180, n)); }} onBlur={() => { const n = Math.max(5, Math.min(180, typed || 45)); setTyped(n); onLength(n); }} /></View>}
        {duration > 0 && <Text className="text-[12.5px] text-muted">{clock(0)} – {clock(length ? Math.min(length, duration) : duration)}</Text>}
      </View>
    </FlowCard>
  );
}

export type ClipOrder = "mix" | "order";
export type Aspect = "9:16" | "4:5" | "1:1" | "16:9";
export type TalkPace = "tight" | "natural" | "relaxed" | "off";
export type ClipSettings = { order: ClipOrder; aspect: Aspect; pace: TalkPace; under: string };

/** Add Your Clips: Videos / Photos, the tap-to-add area, the clips as squares (their length, remove), the clip order,
 * a Talking Reel's pauses and music, and the format. */
export function FlowClips({ kind, photos, onTab, media, onAdd, onRemove, settings, onSettings }: { kind: FlowKind; photos: boolean; onTab: (photos: boolean) => void; media: ImagePickerAsset[]; onAdd: () => void; onRemove: (i: number) => void; settings: ClipSettings; onSettings: (s: Partial<ClipSettings>) => void }) {
  const words = useStudioText(), { width } = useWindowDimensions(), tile = (Math.min(width, 520) - 32 - 36 - 16) / 3;
  return (
    <FlowCard>
      {kind !== "talking" && kind !== "copy" && (
        <View accessibilityRole="radiogroup" className="flex-row gap-1.5 rounded-[14px] border border-border bg-surface-2 p-1">
          {[false, true].map((p) => (
            <Pressable key={String(p)} onPress={() => onTab(p)} accessibilityRole="radio" accessibilityState={{ checked: photos === p }} className="h-10 flex-1 items-center justify-center overflow-hidden rounded-[10px]">
              {photos === p && <Gold />}
              <Text className={`text-[14px] font-semibold ${photos === p ? "text-on-accent" : "text-muted"}`}>{words(p ? "Photos" : "Videos")}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {media.length === 0 ? (
        <Pressable onPress={onAdd} accessibilityRole="button" className="items-center gap-1 rounded-[18px] border-[1.5px] border-dashed border-accent/45 bg-surface-2 px-[18px] py-7 active:opacity-80">
          <View className="mb-1.5"><Icon name="upload" size={34} /></View>
          <Text className="text-[15px] font-semibold text-foreground">{words(photos ? "Tap to Add Photos" : "Tap to Add Videos")}</Text>
          <Text className="text-[13px] text-muted">{words("or choose from gallery")}</Text>
          <Text className="mt-2 text-[12px] text-muted">{words("Supports MP4, MOV, 3GP, JPG, PNG")}</Text>
        </Pressable>
      ) : (
        <View className="gap-2.5">
          <Label>{words("Selected Clips")}</Label>
          <View className="flex-row flex-wrap gap-2">
            {media.map((m, i) => (
              <View key={`${m.uri}-${i}`} className="overflow-hidden rounded-[14px] bg-surface-2" style={{ width: tile, height: tile }}>
                <Thumb uri={m.uri} kind={m.type === "image" ? "image" : "video"} />
                <View className="absolute bottom-1.5 right-1.5 rounded-full bg-black/65 px-2 py-0.5"><Text className="text-[11px] font-semibold text-white">{m.type === "image" ? "5s" : clock((m.duration ?? 0) / 1000)}</Text></View>
                <Pressable onPress={() => onRemove(i)} accessibilityLabel={words("Remove")} hitSlop={6} className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-black/70"><Icon name="close" size={13} color="#fff" /></Pressable>
              </View>
            ))}
            <Pressable onPress={onAdd} accessibilityLabel={words("Add more clips")} className="items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-border bg-surface-2 active:opacity-80" style={{ width: tile, height: tile }}><Icon name="plus" size={28} /></Pressable>
          </View>
        </View>
      )}
      {kind === "talking" ? (
        <>
          <Row label={words("Pauses")}><Segmented small value={settings.pace} onChange={(pace) => onSettings({ pace })} options={(["tight", "natural", "relaxed", "off"] as TalkPace[]).map((v) => ({ value: v, label: words({ tight: "Tight", natural: "Natural", relaxed: "Relaxed", off: "Keep all" }[v]) }))} /></Row>
          <Row label={words("Music under voice")}><Segmented small value={settings.under} onChange={(under) => onSettings({ under })} options={[["0", "Off"], ["0.05", "Soft"], ["0.09", "Medium"], ["0.16", "Loud"]].map(([v, l]) => ({ value: v, label: words(l) }))} /></Row>
        </>
      ) : (
        <Row label={words("Clip order")} note={words(settings.order === "mix" ? "Shubix picks the best moments from all your clips" : "Your clips play one after another, as you added them")}>
          <Segmented small value={settings.order} onChange={(order) => onSettings({ order })} options={[{ value: "mix" as ClipOrder, label: words("Mix all clips") }, { value: "order" as ClipOrder, label: words("In my order") }]} />
        </Row>
      )}
      <Row label={words("Format")}><Segmented small value={settings.aspect} onChange={(aspect) => onSettings({ aspect })} options={(["9:16", "4:5", "1:1", "16:9"] as Aspect[]).map((a) => ({ value: a, label: a === "9:16" ? words("9:16 Reel") : a }))} /></Row>
    </FlowCard>
  );
}
const Row = ({ label, note, children }: { label: string; note?: string; children: ReactNode }) => (
  <View className="gap-2"><Label>{label}</Label>{children}{note ? <Text className="text-[12.5px] text-muted">{note}</Text> : null}</View>
);

/** Analysing (and Exporting): the ring with how far it is, what it is doing now, the steps (working, done) and that
 * nothing is uploaded. `pct` 0…1; `done` how many steps are finished. */
export function FlowAnalyse({ pct, done, status, title = "Analysing Clips", steps = AI_STEPS, sub }: { pct: number; done: number; status: string; title?: string; steps?: [IconName, string][]; sub?: string }) {
  const words = useStudioText(), look = useColors(), r = 52, len = 2 * Math.PI * r;
  return (
    <View className="items-center gap-4 py-2">
      <Text className="text-[22px] font-semibold text-foreground">{words(title)}</Text>
      <View className="h-[150px] w-[150px] items-center justify-center">
        <Svg width={150} height={150} viewBox="0 0 120 120" style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={60} cy={60} r={r} stroke={look.border} strokeWidth={8} fill="none" />
          <Circle cx={60} cy={60} r={r} stroke={look.accent} strokeWidth={8} fill="none" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - pct)} />
        </Svg>
        <Text className="text-[34px] font-semibold text-foreground">{Math.round(pct * 100)}%</Text>
      </View>
      <View className="items-center gap-0.5"><Text className="text-center text-[16px] font-semibold text-foreground">{status}</Text>{sub ? <Text className="text-center text-[13px] text-muted">{sub}</Text> : null}</View>
      <View className="w-full gap-2">
        {steps.map(([icon, t], i) => {
          const s = i < done ? "ok" : i === done ? "now" : "";
          return (
            <View key={t} className="flex-row items-center gap-2.5 py-1">
              <View className={`h-[30px] w-[30px] items-center justify-center rounded-[9px] border ${s === "ok" ? "border-transparent bg-accent" : `border-accent/45 ${s === "now" ? "border-dashed" : ""}`}`}><Icon name={icon} size={17} color={s === "ok" ? "#fff" : "accent"} /></View>
              <Text className={`flex-1 text-[13.5px] font-medium ${s ? "text-foreground" : "text-muted"}`}>{words(t)}</Text>
              <View className={`h-2 w-2 rounded-full ${s === "ok" ? "bg-success" : s === "now" ? "bg-accent" : "bg-border"}`} />
            </View>
          );
        })}
      </View>
      <View className="w-full flex-row items-center justify-center gap-1.5 rounded-[14px] border border-border bg-surface-2 px-3.5 py-3">
        <Icon name="lock" size={15} color="muted" /><Text className="flex-1 text-[12.5px] text-muted">{words("This happens on your phone. Your videos are never uploaded.")}</Text>
      </View>
    </View>
  );
}
