/** Ask Shubix: is a chat message a small change (a few named shots: 1 credit) or a change to the whole Reel (2 credits)?
 * The same words on the phone (what the confirmation says) and on the server (what is charged). When unsure: the whole
 * Reel, so the plan is made again and nothing the person asked is missed. */
const WHOLE = ["whole", "entire", "every ", "all shots", "all clips", "everything", "overall", "faster", "slower", "calmer", "calm ", "cinematic", "energetic",
  "new version", "different version", "another version", "remake", "redo", "style", "mood", "vibe", "pace", "more transitions", "more zooms", "fewer effects", "cleaner",
  "पूर्ण", "सगळ", "सर्व", "संपूर्ण", "sagal", "saglya", "purn", "jalad", "halu"];
const ALL_CLIPS = /\\b(?:all|every|each)\\s+(?:the\\s+)?clips?\\b|\\bclips?\\s+(?:all|every)\\b|\\bsaglya\\s+clips?\\b|\\bsarva\\s+clips?\\b|\\bpratyek\\s+clips?\\b|\\bsabhi\\s+clips?\\b|\\bhar\\s+clip\\b|\\bsaare?\\s+clips?\\b|\\btodos?\\s+(?:los\\s+)?clips?\\b|\\btous\\s+les\\s+clips?\\b|\\balle\\s+clips?\\b/i;\nconst ALL_CLIPS_SCRIPT = /सभी\\s*क्लिप|सारे\\s*क्लिप|हर\\s*क्लिप|पूरे\\s*क्लिप|सगळ्या?\\s*क्लिप|सर्व\\s*क्लिप|प्रत्येक\\s*क्लिप|ಎಲ್ಲಾ\\s*ಕ್ಲಿಪ್|అన్ని\\s*క్లిప్|সব\\s*ক্লিপ|બધા\\s*ક્લિપ|ਸਾਰੇ\\s*ਕਲਿੱਪ|كل\\s*(?:المقاطع|اللقطات)/u;\nconst PART = ["first", "last", "second", "third", "fourth", "fifth", "start", "beginning", "opening", "ending", " end", "intro", "outro", "the drop", "shot ", "clip ",
  "पहिल", "शेवट", "दुसर", "तिसर", "सुरुवात", "pahil", "shevat", "dusr", "suruvat"];
export type ChatSize = "small" | "big";
export function chatSize(text: string): ChatSize {
  const t = " " + text.toLowerCase() + " ";
  if (WHOLE.some((w) => t.includes(w)) || ALL_CLIPS.test(t) || ALL_CLIPS_SCRIPT.test(t)) return "big";
  return PART.some((w) => t.includes(w)) || /\b(shot|clip)\s*#?\d+\b|\b\d+(st|nd|rd|th)\b/.test(t) ? "small" : "big";
}
