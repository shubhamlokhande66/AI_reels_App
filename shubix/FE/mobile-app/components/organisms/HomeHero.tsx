import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, Polygon } from "react-native-svg";
import { LinearGradient as Fill } from "expo-linear-gradient";
import { useText } from "@mobile/hooks";
import { Button, Gold, GoldText, Icon, Paint, cssLine, mix, places, stopsOf, useColors } from "@mobile/ui-mobile";
import { heroArt } from "@mobile/ui-core";

/** Home's hero (the website's components/organisms/home/HomeHero.tsx): the tag, the three-line title, the line, the
 * Create button and the three steps, then the studio picture: a 9:16 Reel at sunset, the soundtrack's bars moving to
 * the beat, the clips and the progress line. The picture's colours and shapes: Shared/ui-core heroArt. */
export function HomeHero({ onCreate }: { onCreate: () => void }) {
  const text = useText(), look = useColors();
  const ground = { angle: 135, stops: [mix(look.surface, look.background, 0.92), look.background], glows: heroArt.glows };
  return (
    <View accessibilityLabel="Make a Reel" className="-mx-4 -mt-4 gap-6 overflow-hidden border-b border-border px-4 pb-6 pt-6">
      <Paint paint={ground} />
      <View className="items-start gap-4">
        <View className="flex-row items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5">
          <Icon name="music" size={14} color="accent" />
          <Text className="text-[10px] font-bold uppercase tracking-[1.8px] text-accent">{text("home.heroTag")}</Text>
        </View>
        <View accessibilityRole="header" className="self-stretch">
          <Text className="text-[30px] font-semibold leading-[30.6px] tracking-[-1.35px] text-foreground">{text("home.hero1")}</Text>
          <GoldText text={text("home.hero2")} className="text-[30px] font-semibold leading-[30.6px] tracking-[-1.35px]" />
          <Text className="text-[30px] font-semibold leading-[30.6px] tracking-[-1.35px] text-foreground/80">{text("home.hero3")}</Text>
        </View>
        <Text className="text-[13.5px] leading-[22px] text-muted">{text("home.heroText")}</Text>
        <Button size="lg" icon="plus" iconAfter="send" title={text("home.heroButton")} onPress={onCreate} className="w-full max-w-[280px]" />
        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          {(["home.step1", "home.step2", "home.step3"] as const).map((key, i) => (
            <View key={key} className="flex-row items-center gap-1.5">
              <View className={`h-1.5 w-1.5 rounded-full ${["bg-accent", "bg-accent/70", "bg-accent/45"][i]}`} />
              <Text className="text-[11px] font-semibold text-muted">{text(key)}</Text>
            </View>
          ))}
        </View>
      </View>
      <StudioPicture />
    </View>
  );
}

/** The studio picture beside the hero's words (decoration: hidden from screen readers). */
function StudioPicture() {
  const text = useText();
  const label = "text-[9px] font-bold uppercase tracking-[1.2px]";
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="w-full max-w-[420px] flex-row items-center gap-3 self-center rounded-[24px] border border-white/10 bg-black/20 p-3">
      <View className="aspect-[9/16] overflow-hidden rounded-[18px] border border-white/15" style={{ flex: 0.72, minWidth: 96 }}>
        <ReelSunset />
        <View className="absolute left-2.5 top-2.5 rounded-full border border-white/25 bg-black/25 px-2 py-1"><Text className="text-[8px] font-bold tracking-[0.96px] text-white/90">{text("home.mockPreview")}</Text></View>
        <View className="absolute inset-0 items-center justify-center">
          <View className="h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-black/25"><Icon name="play" size={16} color="#fff" /></View>
        </View>
        <View className="absolute bottom-2.5 left-2.5 right-2.5 flex-row items-center gap-1.5">
          <Icon name="sparkle" size={11} color="rgba(255,255,255,.8)" />
          <Text className="text-[8px] font-semibold tracking-[0.8px] text-white/80">{text("home.mockMove")}</Text>
        </View>
      </View>
      <View className="min-w-0 gap-3" style={{ flex: 1.28 }}>
        <View className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <View className="mb-2.5 flex-row items-center justify-between gap-2">
            <View className="min-w-0 flex-row items-center gap-2">
              <View className="h-7 w-7 items-center justify-center rounded-lg bg-accent/15"><Icon name="music" size={15} color="accent" /></View>
              <Text numberOfLines={1} className="text-[10px] font-bold uppercase tracking-[1.2px] text-white/75">{text("home.mockSound")}</Text>
            </View>
            <Text className="font-mono text-[9px] text-white/45">00:24</Text>
          </View>
          <SoundBars />
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="font-mono text-[9px] text-white/40">0:00</Text>
            <Text className="font-mono text-[9px] text-accent/85">{text("home.mockBeat")}</Text>
            <Text className="font-mono text-[9px] text-white/40">0:24</Text>
          </View>
        </View>
        <View className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className={`${label} text-white/50`}>{text("home.mockClips")}</Text>
            <Text className="text-[9px] text-white/40">{text("home.mockMoments")}</Text>
          </View>
          <View className="h-9 flex-row gap-1 overflow-hidden rounded-lg">
            {heroArt.clips.map((clip, i) => <View key={i} className="flex-1 overflow-hidden rounded-md"><Paint paint={clip} /></View>)}
          </View>
          <View className="mt-2 h-1 rounded-full bg-white/10">
            <View className="absolute inset-y-0 left-0 w-[62%] overflow-hidden rounded-full"><Gold /></View>
            <View className="absolute -top-1 left-[62%] h-3 w-px bg-white/90" />
          </View>
        </View>
        <View className="flex-row items-center gap-2 pl-1">
          <Pulse />
          <Text className={`min-w-0 flex-1 ${label} font-semibold text-white/45`}>{text("home.mockSync")}</Text>
        </View>
      </View>
    </View>
  );
}

/** The Reel's picture: the sky, the sun and the two hills. */
function ReelSunset() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { w, h } = size;
  return (
    <View className="absolute inset-0" onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Paint paint={heroArt.sky} />
      {w > 0 && (
        <Svg width={w} height={h} style={{ position: "absolute" }}>
          <Ellipse cx={w * 0.41} cy={h * 0.41} rx={w * 0.23} ry={h * 0.23} fill={heroArt.sun} />
          {heroArt.hills.map((hill) => {
            const top = h * (1 - hill.height / 100), hh = (h * hill.height) / 100;
            return [
              <Defs key={`d${hill.height}`}><LinearGradient id={`hill${hill.height}`} gradientUnits="userSpaceOnUse" {...cssLine(hill.paint.angle, w, hh, 0, top)}>{stopsOf(places(hill.paint.stops))}</LinearGradient></Defs>,
              <Polygon key={hill.height} points={hill.points.map(([x, y]) => `${(x / 100) * w},${top + (y / 100) * hh}`).join(" ")} fill={`url(#hill${hill.height})`} />,
            ];
          })}
        </Svg>
      )}
    </View>
  );
}

/** The soundtrack's gold bars, each rising and falling (the website's wave: 30% → 100%), a step after its neighbour.
 * `height`: the row's (40 here; the sign-in band's are smaller). */
export function SoundBars({ height: row = 40 }: { height?: number }) {
  const beats = useRef(heroArt.bars.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = beats.map((beat, i) => Animated.loop(Animated.sequence([
      Animated.delay((i % 9) * 90),
      Animated.timing(beat, { toValue: 1, duration: 1250, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(beat, { toValue: 0, duration: 1250, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [beats]);
  return (
    <View className="flex-row items-center justify-between gap-[2px] overflow-hidden" style={{ height: row }}>
      {heroArt.bars.map((height, i) => (
        <Animated.View key={i} className="overflow-hidden rounded-full" style={{ height: (height * row) / 40, flex: 1, minWidth: 2, maxWidth: 4,
          opacity: beats[i].interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }), transform: [{ scaleY: beats[i].interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
          <Fill colors={heroArt.bar.stops as [string, string]} style={{ flex: 1 }} />
        </Animated.View>
      ))}
    </View>
  );
}

/** The small gold dot that breathes. */
function Pulse() {
  const shown = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(shown, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
      Animated.timing(shown, { toValue: 1, duration: 1000, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [shown]);
  return <Animated.View className="h-1.5 w-1.5 rounded-full bg-accent" style={{ opacity: shown }} />;
}
