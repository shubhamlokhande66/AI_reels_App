import { SvgXml } from "react-native-svg";
import { icons, type IconName } from "@shubix/ui-core";
import { colors } from "../colors";

/** The website's line icons (Shared/ui-core/src/icons.ts), drawn the same: 24 × 24, a 1.8 line in `color`. */
export function Icon({ name, size = 20, stroke = 1.8, color = colors.foreground }: { name: IconName; size?: number; stroke?: number; color?: string }) {
  const xml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}">${icons[name]}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} color={color} />;
}
