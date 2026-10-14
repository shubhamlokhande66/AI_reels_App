import "server-only";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Fonts that can actually draw the text's script. libass shapes complex scripts (Devanagari conjuncts and vowel signs,
 * Arabic joining ...) only with a font that has the script's glyphs and shaping tables; Arial and Georgia have none for
 * Indic scripts, and the glyph fallback breaks words into loose letters. Letter spacing also turns shaping off. So text in
 * such a script gets a font made for it and no extra spacing. */

const RANGES: [number, number, string][] = [
  [0x0900, 0x097f, "devanagari"], [0x0980, 0x09ff, "bengali"], [0x0a00, 0x0a7f, "gurmukhi"], [0x0a80, 0x0aff, "gujarati"],
  [0x0b00, 0x0b7f, "oriya"], [0x0b80, 0x0bff, "tamil"], [0x0c00, 0x0c7f, "telugu"], [0x0c80, 0x0cff, "kannada"],
  [0x0d00, 0x0d7f, "malayalam"], [0x0600, 0x06ff, "arabic"], [0x0e00, 0x0e7f, "thai"],
];
const INDIC = ["devanagari", "bengali", "gurmukhi", "gujarati", "oriya", "tamil", "telugu", "kannada", "malayalam"];
// font families per script, best first: Windows 10+ ships Nirmala UI for every Indic script; the Linux image has Noto
const CANDIDATES: Record<string, string[]> = {
  ...Object.fromEntries(INDIC.map((s) => [s, ["Nirmala UI", `Noto Sans ${s[0].toUpperCase()}${s.slice(1)}`]])),
  devanagari: ["Nirmala UI", "Noto Sans Devanagari", "Mangal"],
  arabic: ["Segoe UI", "Noto Naskh Arabic", "Arial"],
  thai: ["Leelawadee UI", "Noto Sans Thai"],
};
const WIN_FILES: Record<string, string[]> = { "Nirmala UI": ["Nirmala.ttf", "Nirmala.ttc"], Mangal: ["mangal.ttf"], "Segoe UI": ["segoeui.ttf"], "Leelawadee UI": ["LeelawUI.ttf", "LeelaUIb.ttf"] };

/** The first complex script found in the text (null = Latin and other simple scripts). */
export function scriptOf(text: string): string | null {
  for (const ch of text ?? "") {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x0600) continue;
    const r = RANGES.find(([lo, hi]) => lo <= cp && cp <= hi);
    if (r) return r[2];
  }
  return null;
}
export const needsShaping = (text: string) => scriptOf(text) !== null;

let families: Set<string> | null = null;
/** Installed font families (lower case); empty when it cannot be determined. */
function installed(): Set<string> {
  if (families) return families;
  families = new Set();
  try {
    if (process.platform === "win32") {
      const dirs = [path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts"), path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Windows", "Fonts")];
      const files = new Set(dirs.filter((d) => fs.existsSync(d)).flatMap((d) => fs.readdirSync(d).map((f) => f.toLowerCase())));
      for (const [fam, names] of Object.entries(WIN_FILES)) if (names.some((n) => files.has(n.toLowerCase()))) families.add(fam.toLowerCase());
    } else {
      const out = execFileSync("fc-list", [":", "family"], { encoding: "utf8", timeout: 10_000 });
      for (const line of out.split("\n")) for (const f of line.split(",")) if (f.trim()) families.add(f.trim().toLowerCase());
    }
  } catch { /* unknown: the first candidate is used */ }
  return families;
}

/** `preferred` for simple scripts; for a complex script, the first installed font made for it. */
export function fontFor(text: string, preferred: string): string {
  const script = scriptOf(text);
  if (!script) return preferred;
  const cands = CANDIDATES[script] ?? [], have = installed();
  return cands.find((c) => have.has(c.toLowerCase())) ?? cands[0] ?? preferred;
}
