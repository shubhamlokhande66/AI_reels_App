import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { GLYPH_PATHS, icons, type IconName } from "@mobile/ui-core";
import { useColors, type ColorName } from "../theme";

/** The website's line icons (Shared/ui-core/src/icons.ts), drawn the same: 24 × 24, a 1.8 line. `color`: a colour of
 * the look ("muted", "accent"…, following Light / Dark) or any colour. In a View so it stays above a fill like
 * <Gold /> on the web too. */
export function Icon({ name, size = 20, stroke = 1.8, color = "foreground" }: { name: IconName; size?: number; stroke?: number; color?: ColorName | (string & {}) }) {
  const look = useColors();
  const xml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}">${icons[name] ?? icons.sparkle}</svg>`; // an unknown name (from the CMS): the sparkle, as on the website
  return <View style={{ width: size, height: size }}><SvgXml xml={xml} width={size} height={size} color={look[color as ColorName] ?? color} /></View>;
}

/** The studio's tool signs (Shared/ui-core/src/glyphs.ts, the website's markup.ts Glyph): a 1.7 line, the sparkle for
 * a name it does not know. */
export function Glyph({ name, size = 18, color = "foreground" }: { name: string; size?: number; color?: ColorName | (string & {}) }) {
  const look = useColors();
  const xml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPH_PATHS[name] ?? GLYPH_PATHS.Style}"/></svg>`;
  return <View style={{ width: size, height: size }}><SvgXml xml={xml} width={size} height={size} color={look[color as ColorName] ?? color} /></View>;
}
