import { useId, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import type { Paint as PaintData, Stop as PaintStop } from "@mobile/ui-core";

/** A colour as SVG wants it: the colour and its opacity apart ("transparent" fades the neighbour's colour out). */
function split(color: string): [string, number] {
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) { const [r, g, b, a = "1"] = rgba[1].split(",").map((x) => x.trim()); return [`rgb(${r},${g},${b})`, Number(a)]; }
  return color === "transparent" ? ["#000", 0] : [color, 1];
}
/** CSS stops without a place are spread evenly between their neighbours. */
export function places(stops: PaintStop[]): [string, number][] {
  const out = stops.map((s, i): [string, number | null] => (typeof s === "string" ? [s, i === 0 ? 0 : i === stops.length - 1 ? 100 : null] : s));
  for (let i = 0; i < out.length; i++) if (out[i][1] === null) {
    let j = i; while (out[j][1] === null) j++;
    const from = out[i - 1][1]!, to = out[j][1]!;
    for (let k = i; k < j; k++) out[k][1] = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  return out as [string, number][];
}
/** SVG stops for CSS stops ("transparent" next to a colour fades that colour out, as CSS does, not to black). */
export const stopsOf = (stops: [string, number][]) => {
  return stops.map(([c, at], i) => {
    const near = c === "transparent" ? stops[i - 1]?.[0] ?? stops[i + 1]?.[0] ?? "#000" : c;
    const [color, opacity] = split(near);
    return <Stop key={i} offset={at / 100} stopColor={color} stopOpacity={c === "transparent" ? 0 : opacity} />;
  });
};

/** CSS's gradient line for an angle in a w × h box: through the middle, long enough that the corners get the end colours. */
export function cssLine(angle: number, w: number, h: number, x = 0, y = 0) {
  const rad = (angle * Math.PI) / 180, half = (Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad))) / 2;
  const dx = Math.sin(rad) * half, dy = -Math.cos(rad) * half;
  return { x1: x + w / 2 - dx, y1: y + h / 2 - dy, x2: x + w / 2 + dx, y2: y + h / 2 + dy };
}

/** The website's shared backgrounds (Shared/ui-core/src/paint.ts: create cards, template posters), drawn the same as
 * its CSS: a straight gradient at the CSS angle, under round or oval glows. Fills its parent; put it first. */
export function Paint({ paint }: { paint: PaintData }) {
  const id = useId().replace(/:/g, ""), [size, setSize] = useState({ w: 0, h: 0 });
  const { w, h } = size;
  const glows = [...(paint.glows ?? [])].reverse(); // CSS draws the first glow on top
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w > 0 && (
        <Svg width={w} height={h}>
          <Defs>
            <LinearGradient id={`${id}l`} gradientUnits="userSpaceOnUse" {...cssLine(paint.angle, w, h)}>{stopsOf(places(paint.stops))}</LinearGradient>
            {glows.map(([x, y, end, color, ow, oh], i) => {
              const cx = (x / 100) * w, cy = (y / 100) * h;
              const far = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
              const rx = ow === undefined ? far : (ow / 100) * w, ry = oh === undefined ? far : (oh! / 100) * h;
              return (
                <RadialGradient key={i} id={`${id}g${i}`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} fx={cx} fy={cy} rx={rx} ry={ry}>
                  {stopsOf([[color, 0], ["transparent", end]])}
                </RadialGradient>
              );
            })}
          </Defs>
          <Rect width={w} height={h} fill={`url(#${id}l)`} />
          {glows.map((_, i) => <Rect key={i} width={w} height={h} fill={`url(#${id}g${i})`} />)}
        </Svg>
      )}
    </View>
  );
}
