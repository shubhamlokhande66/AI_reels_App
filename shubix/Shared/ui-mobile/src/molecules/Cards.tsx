import type { ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { posterShade, templateArt, templateArtFallback, tones, type IconName, type Tone } from "@shubix/ui-core";
import { accentWash } from "../colors";
import { useColors } from "../theme";
import { Icon } from "../atoms/Icon";
import { Paint } from "../atoms/Paint";
import { Gold } from "../atoms/Gold";
import { Badge, Heading } from "../atoms/Text";
import { Card } from "../atoms/Card";

/** The website's cards (components/molecules: CreateCard, TemplateCard, DraftCard, TipCard, EmptyState, ProBanner,
 * TipsBanner), the same sizes. Texts come in as props (the app reads them from the CMS). */

/** A tone's ground: its gradient (brand: the gold; neutral: the raised surface). */
export const ToneFill = ({ tone }: { tone: Tone }) =>
  tone === "brand" ? <Gold /> : tone === "neutral" ? <View className="absolute inset-0 bg-surface-2" /> : <Paint paint={tones[tone]} />;

/** A figure with its name under it (the website's StatTile: invited, credits earned…). */
export const StatTile = ({ value, label }: { value: ReactNode; label: string }) => (
  <View className="min-w-0 flex-1 gap-0.5 rounded-2xl border border-border bg-surface p-3">
    <Text numberOfLines={1} className="text-[22px] font-semibold leading-[22px] tracking-[-0.2px] text-foreground">{value}</Text>
    <Text numberOfLines={1} className="text-[11px] text-muted">{label}</Text>
  </View>
);

/** An icon on its tone's square (a plan, a Music Reel's note): the website's IconTile. */
export const IconTile = ({ icon, tone = "brand", size = 42 }: { icon: IconName; tone?: Tone; size?: number }) => (
  <View className="items-center justify-center overflow-hidden rounded-xl" style={{ width: size, height: size }}><ToneFill tone={tone} /><Icon name={icon} size={Math.round(size * 0.5)} stroke={2} color="#fff" /></View>
);

/** One way to start a Reel: its tone, a white icon, a title, a line and the arrow chip. `width`: a column of the grid,
 * or the whole row (the Music Reel, a last odd card); `big`: the Music Reel. */
export function CreateCard({ icon, title, text, tone, width, big = false, lock, onPress }: { icon: IconName; title: string; text: string; tone: Tone; width: number; big?: boolean; lock?: ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={title}
      className={`justify-between gap-3 overflow-hidden rounded-2xl border p-3.5 active:opacity-90 ${big ? "min-h-[118px] border-white/30" : "min-h-[108px] border-white/10"}`} style={{ width }}>
      <ToneFill tone={tone} />
      <View className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10" />
      <View className="flex-row items-start justify-between gap-2">
        {big ? <View className="h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/15"><Icon name={icon} size={21} stroke={2} color="#fff" /></View> : <Icon name={icon} size={30} stroke={2} color="#fff" />}
        {lock ?? <View className="h-7 w-7 items-center justify-center rounded-full bg-black/20"><Icon name="send" size={15} stroke={2.4} color="#fff" /></View>}
      </View>
      <View>
        <Text className="text-[14.5px] font-extrabold leading-[18px] text-white">{title}</Text>
        <Text className="text-[11.5px] leading-[15px] text-white/80">{text}</Text>
      </View>
    </Pressable>
  );
}

/** A template's 9:16 poster: its art (or cover), its name in big tilted words, New and its length. */
export function TemplatePoster({ id, name, cover, tag, badge }: { id: string; name: string; cover?: string; tag?: ReactNode; badge: string }) {
  const words = name.replace("/", " ").split(/\s+/).filter(Boolean);
  return (
    <View className="aspect-[9/16] w-full overflow-hidden rounded-[20px] border border-white/[0.12]">
      <Paint paint={templateArt[id] ?? templateArtFallback} />
      {cover && <Image source={{ uri: cover }} className="absolute inset-0 h-full w-full" resizeMode="cover" />}
      <Paint paint={posterShade} />
      <View className="absolute inset-x-3 bottom-10" style={{ transform: [{ rotate: "-3deg" }] }}>
        {words.map((word, i) => <Text key={i} className="text-[15px] font-extrabold uppercase leading-[14.5px] text-white" style={{ textShadowColor: "rgba(0,0,0,.45)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 }}>{word}</Text>)}
      </View>
      {tag && <View className="absolute left-2.5 top-2.5">{tag}</View>}
      <Badge tone="dark" className="absolute bottom-2.5 right-2.5">{badge}</Badge>
    </View>
  );
}

/** A template with its name, kind and look, and what it does (the Templates page). */
export function TemplateCard({ name, meta, text, ...poster }: Parameters<typeof TemplatePoster>[0] & { meta: string; text: string }) {
  return (
    <View className="min-w-0 gap-2">
      <TemplatePoster name={name} {...poster} />
      <Text numberOfLines={1} className="text-[12px] font-bold leading-[15px] text-foreground">{name}</Text>
      <Text numberOfLines={1} className="text-[10px] font-medium text-muted">{meta}</Text>
      <Text numberOfLines={2} className="min-h-[27px] text-[10px] leading-[13.5px] text-muted">{text}</Text>
    </View>
  );
}

/** A Reel's cover in My Reels: its picture (3:4), a fade at the bottom and its length (the website's Cover). */
export function ReelCover({ thumb, duration, children }: { thumb?: string | null; duration: string; children?: ReactNode }) {
  return (
    <View className="aspect-[3/4] w-full overflow-hidden rounded-2xl bg-surface-2">
      {thumb && <Image source={{ uri: thumb }} className="absolute inset-0 h-full w-full" resizeMode="cover" />}
      <Paint paint={{ angle: 0, stops: ["rgba(0,0,0,.45)", ["transparent", 50], "transparent"] }} />
      <View className="absolute bottom-2 left-2 rounded-md bg-[rgba(10,9,8,.72)] px-1.5 py-0.5"><Text className="text-[10px] font-bold text-white">{duration}</Text></View>
      {children}
    </View>
  );
}

/** A Reel being edited: its picture with a play button and its length, its name and when it was last edited. */
export function DraftCard({ name, thumb, duration, edited, onPress, onMore, moreLabel }: { name: string; thumb?: string | null; duration: string; edited: string; onPress: () => void; onMore?: () => void; moreLabel?: string }) {
  return (
    <View className="min-w-0 gap-2">
      <Pressable onPress={onPress} accessibilityLabel={name} className="aspect-[4/3] overflow-hidden rounded-2xl border border-white/10">
        <Paint paint={{ angle: 160, stops: ["#3b2a7a", "#141432"] }} />
        {thumb && <Image source={{ uri: thumb }} className="absolute inset-0 h-full w-full" resizeMode="cover" />}
        <View className="absolute inset-0 bg-black/15" />
        <View className="absolute inset-0 items-center justify-center">
          <View className="h-11 w-11 items-center justify-center rounded-full border-2 border-white/80 bg-black/45"><Icon name="play" size={18} color="#fff" /></View>
        </View>
        <Badge tone="dark" className="absolute bottom-2 right-2">{duration}</Badge>
      </Pressable>
      <View className="flex-row items-start justify-between gap-1">
        <Pressable onPress={onPress} className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[13.5px] font-bold text-foreground">{name}</Text>
          <Text className="text-[11.5px] text-muted">{edited}</Text>
        </Pressable>
        {onMore && <Pressable onPress={onMore} accessibilityLabel={moreLabel} className="h-8 w-8 items-center justify-center rounded-full active:bg-surface-2"><Icon name="more" size={18} color="muted" /></Pressable>}
      </View>
    </View>
  );
}

/** A short tip: a coloured icon, the number and the tip, one line of why (two a row). */
export function TipCard({ n, icon, color, title, text, width }: { n: number; icon: IconName; color: string; title: string; text: string; width: number }) {
  return (
    <View className="min-w-0 gap-1.5 rounded-2xl border border-border bg-surface p-3" style={{ width }}>
      <Icon name={icon} size={26} stroke={2} color={color} />
      <Text className="text-[13px] font-extrabold leading-[17px] text-foreground">{n}. {title}</Text>
      <Text className="text-[12px] leading-[16px] text-muted">{text}</Text>
    </View>
  );
}

/** The empty card: a round icon, a line, a hint and the next step. */
export function EmptyState({ title, hint, action, icon = "sparkle" }: { title: string; hint?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <Card className="items-center gap-2 px-4 py-[22px]">
      <View className="h-[54px] w-[54px] items-center justify-center rounded-full border-[1.5px] border-border"><Icon name={icon} size={24} color="accent" /></View>
      <Heading className="text-center">{title}</Heading>
      {hint && <Text className="max-w-[384px] text-center text-[12.5px] text-muted">{hint}</Text>}
      {action && <View className="mt-1">{action}</View>}
    </Card>
  );
}

/** The shortcut to the tips: a bulb, the title and a line, and a round arrow. */
export function TipsBanner({ title, text, onPress }: { title: string; text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" className="flex-row items-center gap-3 overflow-hidden rounded-2xl border border-accent/40 px-4 py-3 active:border-accent">
      <Paint paint={accentWash(100, useColors())} />
      <Icon name="bulb" size={30} stroke={2} color="accent" />
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-extrabold text-foreground">{title}</Text>
        <Text className="text-[12px] text-muted">{text}</Text>
      </View>
      <View className="h-8 w-8 items-center justify-center rounded-full bg-white/10"><Icon name="chevron" size={18} stroke={2.2} color="foreground" /></View>
    </Pressable>
  );
}
