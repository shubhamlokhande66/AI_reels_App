/** Ask Shubix: is a chat message a small change (a few named shots: 1 credit) or a change to the whole Reel (2 credits)?
 * The same words on the phone (what the confirmation says) and on the server (what is charged). When unsure: the whole
 * Reel, so the plan is made again and nothing the person asked is missed. */
const WHOLE = ["whole", "entire", "every ", "all shots", "all clips", "everything", "overall", "faster", "slower", "calmer", "calm ", "cinematic", "energetic",
  "new version", "different version", "another version", "remake", "redo", "style", "mood", "vibe", "pace", "more transitions", "more zooms", "fewer effects", "cleaner",
  "पूर्ण", "सगळ", "सर्व", "संपूर्ण", "sagal", "saglya", "purn", "jalad", "halu"];
/** Does the message name every clip? One list for the website, the phone and the credit size. */
export function asksForAllClips(value: string): boolean {
  return /\b(?:all|every|each)\s+(?:the\s+)?(?:clips?|videos?)\b|\b(?:clips?|videos?)\s+(?:all|every)\b|\b(?:sagle?|sagale?|saglya?)\s+(?:clips?|videos?)\b|\bsarva\s+(?:clips?|videos?)\b|\bpratyek\s+(?:clips?|videos?)\b|\bsabhi\s+(?:clips?|videos?)\b|\bsaare?\s+(?:clips?|videos?)\b|\bhar\s+(?:ek\s+)?(?:clip|video)\b|\bpoore?\s+(?:clips?|videos?)\b|\b(?:sagle?|sagale?|saglya?)\s+videos?\s+(?:vr|var|la)\b|\bsarva\s+videos?\s+(?:vr|var|la)\b|\btodos?\s+(?:los\s+)?clips?\b|\btous\s+les\s+clips?\b|\balle\s+clips?\b/i.test(value)
    || /सभी\s*क्लिप|सारे\s*क्लिप|हर\s*(?:एक\s*)?क्लिप|पूरे\s*क्लिप|सगळ्या?\s*क्लिप|सर्व\s*क्लिप|प्रत्येक\s*क्लिप|सभी\s*वीडियो|हर\s*(?:एक\s*)?वीडियो|सारे\s*वीडियो|सगळ्या?\s*व्हिडिओ|सर्व\s*व्हिडिओ|प्रत्येक\s*व्हिडिओ|ಎಲ್ಲಾ\s*ಕ್ಲಿಪ್|అన్ని\s*క్లిప్|সব\s*ক্লিপ|બધા\s*ક્લિપ|ਸਾਰੇ\s*ਕਲਿੱਪ|كل\s*(?:المقاطع|اللقطات)|所有片段|每个片段|全部片段|すべてのクリップ|全クリップ|各クリップ|모든\s*클립|각\s*클립|все\s*клипы|каждый\s*клип|todos?\s+os\s+clipes|cada\s+clipe|tutte\s+le\s+clip|ogni\s+clip|alle\s+clips|elke\s+clip|tüm\s+klipler|her\s+klip|semua\s+klip|setiap\s+klip|tất cả\s*(?:các\s*)?clip|mọi\s*clip|ทุกคลิป|همه\s*کلیپ(?:‌ها)?|تمام\s*کلپس|ہر\s*کلپ/u.test(value);
}
const PART = ["first", "last", "second", "third", "fourth", "fifth", "start", "beginning", "opening", "ending", " end", "intro", "outro", "the drop", "shot ", "clip ",
  "पहिल", "शेवट", "दुसर", "तिसर", "सुरुवात", "pahil", "shevat", "dusr", "suruvat"];
export type ChatSize = "small" | "big";
export function chatSize(text: string): ChatSize {
  const t = " " + text.toLowerCase() + " ";
  if (WHOLE.some((w) => t.includes(w)) || asksForAllClips(t)) return "big";
  return PART.some((w) => t.includes(w)) || /\b(shot|clip)\s*#?\d+\b|\b\d+(st|nd|rd|th)\b/.test(t) ? "small" : "big";
}
