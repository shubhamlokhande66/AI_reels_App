import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { icons, type IconName } from "@shubix/ui-core";
import { colors } from "../colors";

/** The website's line icons (Shared/ui-core/src/icons.ts), drawn the same: 24 × 24, a 1.8 line in `color`. In a View so
 * it stays above a fill like <Gold /> on the web too. */
export function Icon({ name, size = 20, stroke = 1.8, color = colors.foreground }: { name: IconName; size?: number; stroke?: number; color?: string }) {
  const xml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}">${icons[name]}</svg>`;
  return <View style={{ width: size, height: size }}><SvgXml xml={xml} width={size} height={size} color={color} /></View>;
}
