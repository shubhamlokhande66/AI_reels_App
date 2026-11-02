import { asksForAllClips } from "@shubix/core/lib/chatSize";

export type DirectorVisualIntent = {
  openingText?: string;
  squareFrameAll?: boolean;
  transitionAll?: boolean;
  transitionType?: string;
  effectsAll?: boolean;
};

const TRANSITION_ALIASES: Array<[string, RegExp]> = [
  ["hard", /\bhard\s*cut\b/i],
  ["fadein", /\bfade\s*in\b|\bfadein\b/i],
  ["flash", /\bflash\b/i],
  ["whip", /\bwhip(?:\s*pan)?\b/i],
  ["zoomout", /\bzoom\s*out\b/i],
  ["zoom", /\bzoom(?:\s*through)?\b/i],
  ["glitch", /\bglitch\b/i],
  ["dip", /\bdip(?:\s*to\s*black)?\b/i],
  ["dissolve", /\bdissolve\b/i],
  ["iris", /\biris\b/i],
  ["wipe", /\bwipe\b/i],
  ["bars", /\bbars?\b/i],
  ["spin", /\bspin\b/i],
  ["diamond", /\bdiamond\b/i],
  ["heart", /\bheart\b/i],
  ["star", /\bstar\b/i],
  ["slideleft", /\b(?:slide|push)\s*left\b/i],
  ["slideright", /\b(?:slide|push)\s*right\b/i],
  ["slideup", /\b(?:slide|push)\s*up\b/i],
  ["slidedown", /\b(?:slide|push)\s*down\b/i],
  ["swipeup", /\bswipe\s*up\b/i],
  ["blur", /\bblur(?:\s*through)?\b/i],
  ["flip", /\b(?:card\s*)?flip\b/i],
  ["luma", /\bluma\b/i],
  ["pixelate", /\bpixelat(?:e|ion)\b/i],
  ["clock", /\bclock\s*(?:wipe|transition)?\b/i],
  ["doors", /\bdoors?\s*(?:open)?\b/i],
  ["ripple", /\bripple\b/i],
  ["burn", /\bfilm\s*burn\b|\bburn\b/i],
  ["dropin", /\bdrop\s*in\b/i],
];

/** Parse explicit visual requests locally so an AI reply cannot silently omit them. */
export function parseDirectorVisualIntent(prompt: string): DirectorVisualIntent {
  const value = String(prompt || "").trim();
  const intent: DirectorVisualIntent = {};
  const asksForText = /\b(text|title|caption|overlay|headline)\b|मजकूर|टेक्स्ट|शीर्षक|عنوان|உரை|వచనం|लिहा|लिही|लिखो|लिखें|दाखवा|दिखाओ|\b(?:liha|lihi|lih|likho|likhe|dakhav|dakhva)\b/i.test(value);
  if (asksForText) {
    const quoted = value.match(/["“]([^"”]{1,80})["”]|'([^']{1,80})'/);
    let text = (quoted?.[1] || quoted?.[2] || "").trim();
    if (!text) {
      const labelled = value.match(/(?:opening|intro|first|hook)?\s*(?:text|title|caption|overlay)\s*(?:effect\s*)?(?:add(?:\s+kar)?|put|show|write|display)?\s*[:=-]?\s*([A-Z0-9][A-Z0-9 !?.-]{0,50})/i);
      const afterVerb = value.match(/(?:write|show|display|लिहा|लिही|लिखो|लिखें|दाखवा|दिखाओ|liha|lihi|lih|likho|likhe|dakhav|dakhva)\s+["']?([A-Z0-9][A-Z0-9 !?.-]{0,50})/i);
      const beforeVerb = value.match(/\b([A-Z][A-Z0-9 !?.-]{0,40})\s+(?:liha|lihi|lih|likho|write)\b/i)
        || value.match(/\b([A-Z][A-Z0-9 !?.-]{0,40})\s+(?:लिहा|लिही|लिखो|लिखें)/i);
      text = (labelled?.[1] || afterVerb?.[1] || beforeVerb?.[1] || "").trim()
        .replace(/\s+(?:at|on|for|in)\s+(?:the\s+)?(?:opening|intro|first|hook).*$/i, "").trim();
    }
    if (text) intent.openingText = text.slice(0, 80);
  }

  const squareFrame = /(?:square\s*(?:frame|border|format)|1\s*:\s*1\s*(?:frame|border|format)?|चौकोनी\s*(?:फ्रेम|फ्रेमिंग)|चौकोर\s*(?:फ्रेम|बॉर्डर)|वर्गाकार\s*(?:फ्रेम|बॉर्डर)|\b(?:chaukor|vargakar)\s+frame\b)/i.test(value);
  const allClips = asksForAllClips(value);
  if (squareFrame && allClips) intent.squareFrameAll = true;

  const namedTransition = TRANSITION_ALIASES.find(([, pattern]) => pattern.test(value))?.[0];
  const asksTransition = /\btransitions?\b|ट्रांजिशन|ट्रान्जिशन|ट्रांज़िशन|संक्रमण|மாற்றம்|మార్పు|পদক্ষেপ|انتقال|转场|过渡|トランジション|切り替え|전환|переход|transição|transicion|transition|übergang|transizione|geçiş|transisi|chuyển\s*cảnh|ทรานซิชัน/u.test(value);
  if (allClips && (asksTransition || namedTransition)) {
    intent.transitionAll = true;
    if (namedTransition) intent.transitionType = namedTransition;
  }
  const asksEffects = /\b(?:effects?|effecr|fx)\b|इफेक्ट(?:्स)?|प्रभाव|असर|ಎಫೆಕ್ಟ್|ఎఫెక్ట్స్?|ইফেক্টস?|અસર|ਪ੍ਰਭਾਵ|تأثيرات?|效果|エフェクト|효과|эффекты|efeitos|efectos|effets|effekte|effetti|efektler|efek|hiệu ứng|เอฟเฟกต์/u.test(value);
  if (allClips && asksEffects) intent.effectsAll = true;
  return intent;
}
