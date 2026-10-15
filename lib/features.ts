/**
 * Features that the backend does not implement yet. The UI shows them disabled instead of
 * pretending they work. Flip a flag when the matching backend phase ships.
 */
export const FEATURES = {
  captions: true, // Phase 9: faster-whisper captions (needs the optional backend package)
  ai: true, // Phase 10: Ollama-assisted decisions (needs OLLAMA_MODEL on the backend)
  // shot effects (zoom pulses, punches, shake, flash, glow), looks and keyframed motion: off for now, clean shots and
  // transitions only. NEXT_PUBLIC_EFFECTS=on turns them on in the editor preview and the renderer alike.
  effects: process.env.NEXT_PUBLIC_EFFECTS === "on",
} as const;
