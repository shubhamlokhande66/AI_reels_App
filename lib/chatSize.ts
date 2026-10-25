/** Ask Shubix: is a chat message a small change (a few named shots: 1 credit) or a change to the whole Reel (2 credits)?
 * The same words on the phone (what the confirmation says) and on the server (what is charged). When unsure: the whole
 * Reel, so the plan is made again and nothing the person asked is missed. */
const WHOLE = ["whole", "entire", "every ", "all shots", "all clips", "everything", "overall", "faster", "slower", "calmer", "calm ", "cinematic", "energetic",
  "new version", "different version", "another version", "remake", "redo", "style", "mood", "vibe", "pace", "more transitions", "more zooms", "fewer effects", "cleaner",
  "पूर्ण", "सगळ", "सर्व", "संपूर्ण", "sagal", "saglya", "purn", "jalad", "halu"];
const PART = ["first", "last", "second", "third", "fourth", "fifth", "start", "beginning", "opening", "ending", " end", "intro", "outro", "the drop", "shot ", "clip ",
  "पहिल", "शेवट", "दुसर", "तिसर", "सुरुवात", "pahil", "shevat", "dusr", "suruvat"];
export type ChatSize = "small" | "big";
export function chatSize(text: string): ChatSize {
  const t = " " + text.toLowerCase() + " ";
  if (WHOLE.some((w) => t.includes(w))) return "big";
  return PART.some((w) => t.includes(w)) || /\b(shot|clip)\s*#?\d+\b|\b\d+(st|nd|rd|th)\b/.test(t) ? "small" : "big";
}
