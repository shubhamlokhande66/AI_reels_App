import { LinearGradient } from "expo-linear-gradient";
import { gradients } from "@shubix/ui-core";

/** The brand's gold gradient (the website's bg-gold, 110°) filling its parent: put it first inside a view with
 * overflow-hidden and a corner radius. */
export const Gold = () => <LinearGradient colors={gradients.gold as unknown as [string, string, string]} start={{ x: 0, y: 0.33 }} end={{ x: 1, y: 0.67 }} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />;
