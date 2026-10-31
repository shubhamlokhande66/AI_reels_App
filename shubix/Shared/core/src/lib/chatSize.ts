/** Ask Shubix: is a chat message a small change (a few named shots: 1 credit) or a change to the whole Reel (2 credits)?
 * The same words on the phone (what the confirmation says) and on the server (what is charged). When unsure: the whole
 * Reel, so the plan is made again and nothing the person asked is missed. */
const WHOLE = ["whole", "entire", "every ", "all shots", "all clips", "everything", "overall", "faster", "slower", "calmer", "calm ", "cinematic", "energetic",
  "new version", "different version", "another version", "remake", "redo", "style", "mood", "vibe", "pace", "more transitions", "more zooms", "fewer effects", "cleaner",
  "पूर्ण", "सगळ", "सर्व", "संपूर्ण", "sagal", "saglya", "purn", "jalad", "halu"];
const ALL_CLIPS = /\b(?:all|every|each)\s+(?:the\s+)?clips?\b|\bclips?\s+(?:all|every)\b|\bsaglya\s+clips?\b|\bsarva\s+clips?\b|\bpratyek\s+clips?\b|\bsabhi\s+clips?\b|\bhar\s+clip\b|\bsaare?\s+clips?\b|\btodos?\s+(?:los\s+)?clips?\b|\btous\s+les\s+clips?\b|\balle\s+clips?\b/i;
const ALL_CLIPS_SCRIPT = /सभी\s*क्लिप|सारे\s*क्लिप|हर\s*क्लिप|पूरे\s*क्लिप|सगळ्या?\s*क्लिप|सर्व\s*क्लिप|प्रत्येक\s*क्लिप|ಎಲ್ಲಾ\s*ಕ್ಲಿಪ್|అన్ని\s*క్లಿಪ్|সব\s*ক্লিপ|બધા\s*ક્લિપ|ਸਾਰੇ\s*ਕਲਿੱਪ|كل\s*(?:المقاطع|اللقطات)|所有片段|每个片段|全部片段|すべてのクリップ|全クリップ|各クリップ|모든\s*클립|각\s*클립|все\s*клипы|каждый\s*клип|todos?\s+os\s+clipes|cada\s+clipe|tutte\s+le\s+clip|ogni\s+clip|alle\s+clips|elke\s+clip|tüm\s+klipler|her\s+klip|semua\s+klip|setiap\s+klip|tất cả\s*(?:các\s*)?clip|mọi\s*clip|ทุกคลิป|همه\s*کلیپ(?:‌ها)?|تمام\s*کلپس|ہر\s*کلپ/u;
const PART = ["first", "last", "second", "third", "fourth", "fifth", "start", "beginning", "opening", "ending", " end", "intro", "outro", "the drop", "shot ", "clip ",
  "पहिल", "शेवट", "दुसर", "तिसर", "सुरुवात", "pahil", "shevat", "dusr", "suruvat"];
export type ChatSize = "small" | "big";
export function chatSize(text: string): ChatSize {
  const t = " " + text.toLowerCase() + " ";
  if (WHOLE.some((w) => t.includes(w)) || ALL_CLIPS.test(t) || ALL_CLIPS_SCRIPT.test(t)) return "big";
  return PART.some((w) => t.includes(w)) || /\b(shot|clip)\s*#?\d+\b|\b\d+(st|nd|rd|th)\b/.test(t) ? "small" : "big";
}
