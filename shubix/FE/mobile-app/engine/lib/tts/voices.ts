/** The languages offered for text to speech. The voice itself is the phone's own (modules/shubix-video/.../SystemVoice.kt).
 * Kept apart from the client so the page can list them without loading it. */
export type TtsVoice = { key: string; label: string; lang: string };
export const TTS_VOICES: TtsVoice[] = [
  { key: "en-US", label: "English (US)", lang: "English" },
  { key: "en-GB", label: "English (UK)", lang: "English" },
  { key: "hi-IN", label: "हिन्दी (Hindi)", lang: "Hindi" },
  { key: "mr-IN", label: "मराठी (Marathi)", lang: "Marathi" },
  { key: "te-IN", label: "తెలుగు (Telugu)", lang: "Telugu" },
  { key: "ml-IN", label: "മലയാളം (Malayalam)", lang: "Malayalam" },
];
/** A Reel saved earlier names a voice like hi_IN-rohan-medium: its language. */
export const voiceLanguage = (voice: string) => voice.includes("_") ? voice.split("-")[0].replace("_", "-") : voice;
