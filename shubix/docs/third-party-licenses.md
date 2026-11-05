# Third-party licences

Audit of 2026-11-04. This is an engineering check, not legal advice. Free to download does not always mean free for a paid product, so check each new library, model and voice before adding it. Run `pnpm licenses list --prod` and `pnpm audit --prod` from `shubix/`.

## Fixed

| What | Licence or problem | Fix |
|---|---|---|
| `essentia.js` on the server | AGPL-3.0 | Removed. Onsets and the second tempo estimate use our own code |
| Piper voices in the Android app | 4 of 9 are CC BY-NC-SA (non-commercial); 5 are not clear | Removed from Android. It uses the phone's own text-to-speech |
| `piper-phonemize` (espeak-ng) in the Android app | GPL-3.0 | Removed from Android |
| Piper voices and `piper-phonemize` on the website | The same | Removed. Text to speech and Story Maker are off on the website, and `/create/story` goes to Music Reel |
| `multer` | High severity denial of service | Now 2.5.0 |

Android's voice choice is now by language, not by person. A language must be installed on the phone for offline use, or the app says to add it in Settings.

## Open

| What | Where | Status |
|---|---|---|
| Website voice | Website | Off until a voice that is safe for a paid product is chosen. Story Maker's other code is kept for that |
| Licence notices screen | App and website | Not built. MIT, BSD, Apache, MPL and LGPL parts ask for their notices to be kept |
| `zod`, `glob`, `minimatch` (moderate to high) | Inside `@expo/cli`, a build tool | Not shipped in the app. Waits for an Expo update |
| `deepmerge` (low) | Inside `@expo/config` | No fixed version exists |

## Fine to use, with notices kept

| What | Licence |
|---|---|
| Beat This! code and weights | MIT |
| Silero VAD | MIT |
| MediaPipe selfie segmentation and BlazeFace | Apache-2.0 |
| ONNX Runtime | MIT |
| Media3 | Apache-2.0 |
| tracking.js | BSD |
| `mediabunny`, `@mediabunny/aac-encoder` | MPL-2.0. The encoder is built from FFmpeg, whose licence terms need a check for the notices screen |
| `sharp` (libvips) | Apache-2.0 and LGPL-3.0, on the server |
| `node-forge` | BSD-3-Clause or GPL-2.0: we use it under BSD |

Not checked here: ML Kit's Google terms, the licences of the bundled fonts, and FFmpeg as installed on the server.
