/** Backgrounds both apps draw from the same numbers (web: Shared/ui-web paintCss → a CSS background; phone:
 * Shared/ui-mobile <Paint />, drawn with SVG): a straight gradient under soft round glows.
 * `stops`: a colour, or [colour, where in %]. A glow: [x %, y %, where it fades out in %, colour] and, for an oval,
 * its size [width %, height %] (else a circle reaching the farthest corner). */
export type Stop = string | [string, number];
export type Glow = [number, number, number, string] | [number, number, number, string, number, number];
export type Paint = { angle: number; stops: Stop[]; glows?: Glow[] };

const two = (from: string, to: string): Paint => ({ angle: 135, stops: [from, to] });

/** The colour of each way to start (Home's cards, the CMS's tone picker, icon tiles). */
export type Tone = "music" | "talk" | "photo" | "story" | "template" | "copy" | "recreate" | "brand" | "neutral";
export const tones: Record<Exclude<Tone, "brand" | "neutral">, Paint> = {
  music: two("#d8bd7b", "#80683a"),
  talk: two("#7187a1", "#33445a"),
  photo: two("#c2845f", "#704535"),
  story: two("#65977c", "#315d49"),
  template: two("#aa7d91", "#624657"),
  copy: two("#65949a", "#345b60"),
  recreate: two("#82799f", "#4c4567"),
};

/** Each template's poster art, until a cover picture is set (Admin → Templates). */
const art = (angle: number, stops: Stop[], ...glows: Glow[]): Paint => ({ angle, stops, glows });
export const templateArt: Record<string, Paint> = {
  montage: art(160, ["#ff3fd0", ["#6d28d9", 55], "#1a0b3d"], [70, 25, 40, "rgba(255,120,240,.75)"]),
  beforeafter: art(160, ["#c08a6a", ["#5b3b2e", 60], "#1e1412"], [40, 30, 38, "rgba(255,220,190,.6)"]),
  talking: art(160, ["#ff7a59", ["#7c2d92", 60], "#1a0b3d"], [50, 35, 35, "rgba(255,200,160,.55)"]),
  tutorial: art(160, ["#3b8bff", ["#1d3a8a", 60], "#0b1030"], [60, 30, 38, "rgba(140,200,255,.6)"]),
  product: art(160, ["#b8742f", ["#4a2a12", 60], "#150b05"], [55, 40, 35, "rgba(255,200,120,.8)"]),
  recipe: art(160, ["#e0782f", ["#7a2e12", 60], "#1f0c06"], [50, 55, 40, "rgba(255,170,80,.85)"]),
  travel: art(180, ["#5fb6ff", ["#2a6fb0", 45], ["#2f7a6a", 70], "#123a2e"], [50, 20, 30, "rgba(255,255,255,.65)"]),
  ganpati: art(160, ["#ff7a1a", ["#b0201f", 55], "#2a0606"], [60, 35, 38, "rgba(255,190,90,.85)"]),
  diwali: art(160, ["#4a1d6b", "#1a0b3d"], [40, 40, 30, "rgba(255,210,110,.85)"], [75, 70, 28, "rgba(255,120,60,.6)"]),
  cardelivery: art(160, ["#2b2b2b", ["#0d0d0d", 60], "#000"], [50, 70, 35, "rgba(255,60,60,.7)"]),
  opening: art(160, ["#d4a017", ["#7a1f1f", 60], "#1c0707"], [50, 30, 35, "rgba(255,215,90,.8)"]),
  party: art(160, ["#120a2e", "#05030f"], [30, 30, 35, "rgba(120,80,255,.8)"], [75, 60, 30, "rgba(255,60,200,.6)"]),
};
export const templateArtFallback = art(160, ["#70603c", ["#332c20", 60], "#151411"], [60, 30, 38, "rgba(216,189,123,.45)"]);
/** The dark fade at the bottom of a poster, so its words read. */
export const posterShade: Paint = { angle: 180, stops: [["rgba(0,0,0,.06)", 8], ["transparent", 38], ["rgba(0,0,0,.14)", 58], ["rgba(0,0,0,.78)", 100]] };

/** Home's studio picture (the hero): the Reel's sunset, its two hills (points in % of their box), the four clips,
 * the sound wave's bar heights (px) and the hero's glows. */
export const heroArt = {
  glows: [[82, 18, 58, "rgba(216,189,123,.2)", 70, 100], [8, 100, 70, "rgba(216,189,123,.07)", 48, 80]] as Glow[], // over the page's surface → background
  sky: { angle: 180, stops: [["#c6a766", 0], ["#76613b", 38], ["#3b3427", 58], ["#171714", 100]] } as Paint,
  sun: "rgba(242,217,154,.8)",
  hills: [
    { height: 58, paint: { angle: 160, stops: [["transparent", 10], ["rgba(23,22,18,.72)", 10.5], ["#171714", 72]] } as Paint, points: [[0, 48], [32, 0], [55, 42], [73, 18], [100, 52], [100, 100], [0, 100]] },
    { height: 36, paint: { angle: 165, stops: [["transparent", 5], ["#29271f", 5.5], ["#111110", 90]] } as Paint, points: [[0, 40], [24, 4], [49, 45], [72, 0], [100, 28], [100, 100], [0, 100]] },
  ],
  clips: [["#b9a06d", "#555044", "#26251f"], ["#9c8970", "#484138", "#23221e"], ["#bea77e", "#66573f", "#28251f"], ["#776e58", "#3e3a30", "#1f1e1a"]]
    .map(([a, b, c]): Paint => ({ angle: 145, stops: [a, [b, 55], c] })),
  bars: [8, 14, 22, 11, 28, 17, 34, 12, 23, 38, 18, 29, 13, 35, 20, 10, 31, 16, 39, 24, 12, 30, 19, 36, 14, 25, 9, 33, 18, 28, 12, 38, 20, 30, 14, 24],
  bar: { angle: 180, stops: ["#f0d99b", "#a98a4a"] } as Paint,
};

/** Each plan's icon and tone on the Pricing page (a plan the administrator adds gets the star on the gold). */
export const planLooks: Record<string, { icon: string; tone: Tone }> = {
  free: { icon: "sparkle", tone: "talk" },
  creator: { icon: "bolt", tone: "music" },
  pro: { icon: "crown", tone: "photo" },
  business: { icon: "bag", tone: "recreate" },
};
export const planLook = (id: string) => planLooks[id] ?? { icon: "star", tone: "brand" as Tone };
