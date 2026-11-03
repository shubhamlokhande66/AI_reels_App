import { useRef, useState } from "react";
import { PanResponder, Text, View, type LayoutChangeEvent } from "react-native";

/** The website's range slider (the studio's Clip tools): a name, a track to drag along, the value. `onChange` while it
 * moves is left out on purpose: the value is sent once, when the finger lifts (`onDone`), so the studio is not flooded. */
export function Slider({ label, value, min, max, step = 0.01, format, onDone }: { label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string; onDone: (v: number) => void }) {
  const [v, setV] = useState(value), w = useRef(1), cur = useRef(value);
  const at = (x: number) => { const r = Math.max(0, Math.min(1, x / w.current)), raw = min + r * (max - min), s = Math.round(raw / step) * step; return +Math.max(min, Math.min(max, s)).toFixed(4); };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { cur.current = at(e.nativeEvent.locationX); setV(cur.current); },
    onPanResponderMove: (e) => { cur.current = at(e.nativeEvent.locationX); setV(cur.current); },
    onPanResponderRelease: () => onDone(cur.current),
  })).current;
  const r = (v - min) / (max - min || 1);
  return (
    <View className="gap-1">
      <View className="flex-row justify-between"><Text className="text-[12.5px] font-semibold text-foreground">{label}</Text><Text className="text-[12px] text-muted">{format ? format(v) : v.toFixed(2)}</Text></View>
      <View {...pan.panHandlers} onLayout={(e: LayoutChangeEvent) => { w.current = Math.max(1, e.nativeEvent.layout.width); }} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: v }}
        className="h-8 justify-center">
        <View pointerEvents="none" className="h-1.5 rounded-full bg-surface-2"><View className="h-1.5 rounded-full bg-accent" style={{ width: `${r * 100}%` }} /></View>
        <View pointerEvents="none" className="absolute h-5 w-5 rounded-full border-2 border-accent bg-surface" style={{ left: `${r * 100}%`, marginLeft: -10 }} />
      </View>
    </View>
  );
}
