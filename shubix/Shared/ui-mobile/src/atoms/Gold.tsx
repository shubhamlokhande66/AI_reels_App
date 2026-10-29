import { LinearGradient } from "expo-linear-gradient";
import { useColors, useGradients } from "../theme";

type Colors = [string, string, ...string[]];
const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

/** The brand's gold gradient (the website's bg-gold, 110°) filling its parent: put it first inside a view with
 * overflow-hidden and a corner radius. */
export const Gold = () => <LinearGradient colors={useGradients().gold as unknown as Colors} start={{ x: 0, y: 0.33 }} end={{ x: 1, y: 0.67 }} style={fill} />;

/** The menu's ground (the website's --sidebar): top to bottom, the second colour from 78%. */
export const Sidebar = () => <LinearGradient colors={useGradients().sidebar as unknown as Colors} locations={[0, 0.78]} style={fill} />;

/** The thin gold line along the top of a bar (the website's before:via-accent/45), 32px in from each side. */
export const Hairline = ({ strength = 0.45 }: { strength?: number }) => (
  <LinearGradient colors={["transparent", useColors().accent + Math.round(strength * 255).toString(16).padStart(2, "0"), "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
    style={{ position: "absolute", top: 0, left: 32, right: 32, height: 1 }} />
);
