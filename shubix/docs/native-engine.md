# The Android app's native video engine

Goal: on the Android app, the Reel plays live with the studio's full look (every transition, effect, mask, curve and
keyframe), smooth, on the phone's GPU. Today the full look shows only when paused (a picture from the hidden studio page)
and in the export.

The engine is the app's own Expo module `FE/mobile-app/modules/shubix-video` (Kotlin, Google's Media3 1.8):

- `ShubixVideoModule.buildComposition(spec)` turns the Reel into a Media3 `Composition`: the clips with their changes and
  texts, and the song under them. The export (`Transformer`) and the live preview use the same Composition, so what plays
  is what the export makes.
- `ShubixPreviewView` plays that Composition live (Media3 `CompositionPlayer` on a `SurfaceView`).
- JS: `lib/video.ts` `previewSpec()` builds the spec at half size (540 px on the short side), and the editor's `LivePlayer`
  (`app/editor.tsx`) shows it in the Preview while playing. If it fails on a phone, the editor goes back to the old
  preview for that Reel.

## Steps

1. **DONE: the live native player.** It plays the whole Reel (clips, speed, filters, the native transitions and effects,
   texts, song) with what the native export already supports. The studio-only tools (`cs`: masks, curves, HSL, picture
   effects, the 44 transitions) are not in it yet.
2. **DONE: the studio's shaders in one shared file** (`Shared/core/src/lib/shaders.ts`). Move the GLSL of the studio's GPU passes (picture effects `PIC_FX`,
   Curves / HSL, the transitions' `GLSL_F` modes) out of `FE/web-app/components/studio/engine.ts` into a shared package
   file. The website keeps using it as it does now,; the phone's JS sends it to the Android engine with the Reel (no copy, so the two can never differ). Then
   both engines run the same shader text, and the website's `studio-shader` test keeps guarding it.
3. **DONE (picture effects, Curves, HSL; adjust and looks move to step 4): native GPU passes from those shaders** (`StudioPasses.kt`). In Kotlin, one Media3 `GlEffect` (a `BaseGlShaderProgram`) per pass, with the
   same uniforms the website sets: picture effects, Curves and HSL, adjust (bri, con, sat, warm, hi, sh, hue, sharpen,
   vignette), the look (`GRADES`), 3D zoom, canvas patterns.
4. **DONE (adjust with keyframes, Curves, HSL; the studio look is still the phone filter): the studio's shot settings in the spec.** The phone gets each shot's `cs` (and its keyframes `kx`) from the studio
   (`engine.tool("state")`) and sends them in the spec; the Kotlin passes read them per frame (keyframes as on the
   website, `kxAt`).
5. **DONE (masks with their keyframes, chroma key; video boxes and blend still open): masks, chroma key, blend, boxes.** Mask shapes and chroma key as GPU passes. Video boxes (layers) as extra Composition
   sequences.
6. **DONE (all 44, the outgoing shot's last frame as on the website; StudioTransitions.kt): the 44 transitions.** Two shots overlap for the transition's length. Media3 sequences don't overlap, so the
   transition is drawn by one GPU pass that reads the end of one shot and the start of the next.
7. **DONE (StudioTexts.kt; Google fonts drawn in the nearest Android family, text behind the person and follow-the-person not yet): texts as the studio draws them.** Its styles, fonts, entrances, exits, loops and keyframes, drawn per frame onto a
   bitmap overlay.
8. **Parity check, not done.** The page was removed first, by decision, so the phone's export was never compared with the page's frame by frame.

Each step ships on its own: the live preview gets a little closer to the studio's look with each one, and the export
stays on the studio until step 8.

## AI models on the phone

`Models.kt` runs the beat tracker, speech finder, person mask and faces with ONNX Runtime for Android. `SystemVoice.kt` speaks with the phone's own text-to-speech. The hidden page reaches it through the file server (`/model`, `/onnx`, `/speech`, `/speak`). If the phone's model fails, the page's WebAssembly copy takes over and a warning goes to the console.

Tested on a computer: `Models.kt` on the JVM against the page's copies passed, with beats up to 20 ms apart. `SystemVoice.kt` needs a phone. Neither has run on a phone.

## The studio on the phone

The app has one engine and no hidden page: the WebView, its page and `engine/build.mjs` are gone.

- `lib/engine.ts`: what the screens call. `lib/nativeEngine.ts`: every operation, on the brain.
- `engine/brain/host.ts`: the song, part and clip flows, Shubix AI, the plan's export rules. It starts from `engine/brain/initial-state.json`, a saved start state that nothing makes any more: change it by hand.
- `engine/brain/chat.ts`, `small.ts`: Ask Shubix and small rules.
- Kotlin, through the file server: `SongAnalysis.kt` (`/song`), `ClipStats.kt` and `ClipScan.kt` (`/scan`), `ClipFaces.kt` (`/faces`), `/probe`, `/aiframes`, `SystemVoice.kt` (`/speak`), `/copy`, `/sound`, `/out`, and `/api`, passed on to the server.
- Export: the sound from the brain (`exportMix`), then the picture, its layers, watermark, quality and frame rate from `exportReel` in `lib/video.ts`. `nativeExportGaps` names what it leaves out.

Tested: `tests/native-engine.test.ts` runs the operations against a fake file server; `song-parity.mjs` and `clip-parity.mjs` compare Kotlin on a computer with the JavaScript; the whole app compiles with Metro and Hermes. It has not been run on a phone since the page was removed, and the page-versus-brain golden went with the page (last passed before the removal, git history has `scripts/engine-golden.mjs`).

What the page did that this does not:

- Sound: no fast limiter, only a peak step; no noise cleanup on clip voices.
- Captions: the words are heard from a plain 16 kHz copy, without the page's filters.
- A clip is copied only when its long side is over 1920 px; the page also copied HDR, 60 fps and clips with a changing frame rate.
- A beat shape is centred on the frame; a layer's mask has no soft edge; My Reels is not offered at export; the paused picture comes from the live player, with no studio frame.
