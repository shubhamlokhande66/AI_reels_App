/** The text-to-speech voices offered in Fast Studio (Piper, rhasspy/piper-voices; "medium" quality: clear and small
 * enough for phones). Kept apart from the client so the page can list them without loading it. */
export type TtsVoice = { key: string; label: string; lang: string; mb: number };
// the voices offered (Piper's "medium" quality: clear and small enough for phones)
export const TTS_VOICES: TtsVoice[] = [
  { key: "en_US-hfc_female-medium", label: "English · woman", lang: "English", mb: 63 },
  { key: "en_US-hfc_male-medium", label: "English · man", lang: "English", mb: 63 },
  { key: "en_GB-jenny_dioco-medium", label: "English (UK) · woman", lang: "English", mb: 63 },
  { key: "hi_IN-priyamvada-medium", label: "हिन्दी · महिला (Priyamvada)", lang: "Hindi", mb: 64 },
  { key: "hi_IN-rohan-medium", label: "हिन्दी · पुरुष (Rohan)", lang: "Hindi", mb: 63 },
  { key: "hi_IN-pratham-medium", label: "हिन्दी · पुरुष (Pratham)", lang: "Hindi", mb: 64 },
  { key: "mr_IN-google-medium", label: "मराठी (Marathi)", lang: "Marathi", mb: 77 },
  { key: "te_IN-maya-medium", label: "తెలుగు · Maya (Telugu)", lang: "Telugu", mb: 63 },
  { key: "ml_IN-meera-medium", label: "മലയാളം · Meera (Malayalam)", lang: "Malayalam", mb: 63 },
];
const BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";
/** en_US-hfc_female-medium -> en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx */
export function voiceUrl(key: string): { model: string; config: string } {
  const [code, name, q] = key.split("-"), path = `${BASE}${code.split("_")[0]}/${code}/${name}/${q}/${key}.onnx`;
  return { model: path, config: path + ".json" };
}
