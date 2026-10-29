import { Image } from "react-native";

/** The Shubix logo with its name (the website's components/atoms/Logo.tsx, the same pictures): the big one above 60px. */
export function Logo({ height = 40 }: { height?: number }) {
  return (
    <Image source={height > 60 ? require("../../assets/brand/shubix-gold.webp") : require("../../assets/brand/shubix-gold-sm.webp")}
      accessibilityLabel="Shubix · Reels video studio" resizeMode="contain" style={{ height, width: Math.round(height * 1.36) }} />
  );
}
