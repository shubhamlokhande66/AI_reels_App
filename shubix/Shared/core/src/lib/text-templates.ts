/** Ready-made animated titles (as CapCut's text templates): each is one or more texts that come in together, every one with
 * its own style, font, colour, entrance, exit and loop. `t` is when a part comes in (seconds after the template starts);
 * `{1}` and `{2}` are the creator's (or Shubix AI's) words, `words` the template's own sample words. The website, the
 * Android app and the AI share this list. */
export type TextPart = { text: string; style: string; font?: string; color: string; anim: string; out?: string; loop?: string; x: number; y: number; size: number; t: number };
export type TextTemplate = { name: string; len: number; words: [string, string]; parts: TextPart[] };

const P = (text: string, style: string, color: string, anim: string, y: number, size: number, t = 0, more: Partial<TextPart> = {}): TextPart =>
  ({ text, style, color, anim, out: "fade", x: 0.5, y, size, t, ...more });

export const TEXT_TEMPLATES: Record<string, TextTemplate> = {
  headline: { name: "Headline", len: 3, words: ["BIG NEWS", "you need to see this"], parts: [P("{1}", "bold", "#FFFFFF", "zoom", 0.4, 1.5, 0, { font: "anton", out: "zoom" }), P("{2}", "clean", "#FFD54A", "slide", 0.5, 0.75, 0.35)] },
  neon: { name: "Neon sign", len: 3, words: ["OPEN LATE", ""], parts: [P("{1}", "neon", "#FF6FD8", "flicker", 0.4, 1.4, 0, { font: "bebas", loop: "pulse" })] },
  breaking: { name: "Breaking", len: 3.5, words: ["Something big happened", ""], parts: [P("BREAKING", "tag", "#FF3B30", "pop", 0.3, 0.8, 0, { font: "oswald" }), P("{1}", "box", "#111111", "type", 0.38, 0.9, 0.3)] },
  vlog: { name: "Vlog", len: 3, words: ["Day in my life", "Pune"], parts: [P("{1}", "clean", "#FFFFFF", "fade", 0.42, 1.3, 0, { font: "caveat" }), P("📍 {2}", "clean", "#FFFFFF", "slide", 0.5, 0.7, 0.4)] },
  quote: { name: "Quote", len: 4, words: ["Dream big, start small", "Shubix"], parts: [P("“{1}”", "shadow", "#FFFFFF", "blur", 0.42, 1.1, 0, { font: "playfair" }), P("— {2}", "clean", "#D4B07A", "fade", 0.52, 0.65, 0.6)] },
  sale: { name: "Sale", len: 3, words: ["50% OFF", "today only"], parts: [P("SALE", "bold", "#FFD54A", "pop", 0.32, 2, 0, { font: "bangers", loop: "bounce" }), P("{1}", "tag", "#FF3B30", "drop", 0.45, 1.1, 0.25), P("{2}", "clean", "#FFFFFF", "fade", 0.54, 0.7, 0.5)] },
  follow: { name: "Follow", len: 3, words: ["More tips every day", ""], parts: [P("{1}", "box", "#4DA3FF", "pop", 0.62, 0.85), P("Follow 👉", "bubble", "#FFFFFF", "pop", 0.7, 0.8, 0.35, { loop: "wiggle" })] },
  glitch: { name: "Glitch title", len: 2.5, words: ["GAME ON", ""], parts: [P("{1}", "stack", "#3DDC84", "glitch", 0.42, 1.5, 0, { font: "bebas", loop: "shake", out: "blur" })] },
  welcome: { name: "Video in letters", len: 3.5, words: ["WELCOME", "to the channel"], parts: [P("{1}", "cutout", "#FFFFFF", "zoom", 0.42, 2.2, 0, { font: "anton", out: "zoom" }), P("{2}", "clean", "#FFFFFF", "fade", 0.56, 0.7, 0.5)] },
  chapter: { name: "Chapter", len: 3, words: ["The beginning", "1"], parts: [P("CHAPTER {2}", "outline", "#FFFFFF", "fade", 0.36, 0.7, 0, { font: "montserrat" }), P("{1}", "bold", "#FFFFFF", "slide", 0.44, 1.2, 0.3, { font: "bebas" })] },
  love: { name: "Love", len: 3, words: ["Forever us", ""], parts: [P("{1}", "glow", "#FF6FD8", "fade", 0.42, 1.4, 0, { font: "pacifico", loop: "float" }), P("❤️", "clean", "#FFFFFF", "pop", 0.52, 1.2, 0.4, { loop: "pulse" })] },
  festival: { name: "Festival", len: 3.5, words: ["शुभ दीपावली", "🪔"], parts: [P("{1}", "neon", "#FFD54A", "pop", 0.38, 1.4, 0, { font: "rozha", loop: "pulse" }), P("{2}", "clean", "#FFFFFF", "drop", 0.5, 1.4, 0.4, { loop: "swing" })] },
  step: { name: "Step", len: 3, words: ["Mix it well", "1"], parts: [P("STEP {2}", "tag", "#FFD54A", "slide", 0.2, 0.8, 0), P("{1}", "box", "#111111", "slide", 0.27, 0.9, 0.2)] },
  typewriter: { name: "Typewriter", len: 3.5, words: ["Here is how I did it", ""], parts: [P("{1}", "clean", "#FFFFFF", "type", 0.42, 1, 0, { font: "poppins" })] },
  spinin: { name: "Spin in", len: 2.5, words: ["WOW", ""], parts: [P("{1}", "bold", "#FFFFFF", "spin", 0.42, 1.8, 0, { font: "bangers", out: "spin" })] },
  price: { name: "Price", len: 3, words: ["₹999", "only"], parts: [P("{1}", "tag", "#FFD54A", "drop", 0.6, 1.3, 0, { loop: "bounce" }), P("{2}", "clean", "#FFFFFF", "fade", 0.68, 0.7, 0.3)] },
};

/** a template's parts with the words in, each with its own start (seconds after `at`) and end (all end together) */
export function templateTexts(key: string, words: string[] = [], at = 0, len?: number) {
  const T = TEXT_TEMPLATES[key]; if (!T) return [];
  const L = Math.max(0.6, Math.min(30, len ?? T.len)), w = [0, 1].map((i) => String(words[i] ?? T.words[i] ?? "").trim().slice(0, 120));
  return T.parts.map((p) => ({ ...p, text: p.text.replace("{1}", w[0]).replace("{2}", w[1]).trim(), start: at + Math.min(p.t, L - 0.3), end: at + L }))
    .filter((p) => p.text && p.text !== "—" && p.text !== "“”" && p.text !== "📍");
}
