export type DirectorVisualIntent = {
  openingText?: string;
  squareFrameAll?: boolean;
};

/** Parse only explicit, renderable visual requests. Do not infer text content from the AI's explanation. */
export function parseDirectorVisualIntent(prompt: string): DirectorVisualIntent {
  const value = String(prompt || "").trim();
  const intent: DirectorVisualIntent = {};
  const asksForText = /\b(text|title|caption|overlay|headline)\b|मजकूर|टेक्स्ट/i.test(value);
  if (asksForText) {
    const quoted = value.match(/["“]([^"”]{1,80})["”]|'([^']{1,80})'/);
    let text = (quoted?.[1] || quoted?.[2] || "").trim();
    if (!text) {
      const match = value.match(/(?:opening|intro|first|hook)?\s*(?:text|title|caption|overlay)\s*(?:effect\s*)?(?:add(?:\s+kar)?|put|show|write|display)?\s*[:=-]?\s*([A-Z0-9][A-Z0-9 !?.-]{0,50})/i);
      text = (match?.[1] || "").trim().replace(/\s+(?:at|on|for|in)\s+(?:the\s+)?(?:opening|intro|first|hook).*$/i, "").trim();
    }
    if (text) intent.openingText = text.slice(0, 80);
  }

  const squareFrame = /(?:square\s*(?:frame|border)|1\s*:\s*1\s*(?:frame|border)?)/i.test(value);
  const allClips = /\b(all|every|each)\s+(?:the\s+)?clips?\b|\bclips?\s+(?:all|every)\b|\bsaglya\s+clips?\b|\bsarva\s+clips?\b|सर्व\s*क्लिप/i.test(value);
  if (squareFrame && allClips) intent.squareFrameAll = true;
  return intent;
}
