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
2. **The studio's shaders in one shared file.** Move the GLSL of the studio's GPU passes (picture effects `PIC_FX`,
   Curves / HSL, the transitions' `GLSL_F` modes) out of `FE/web-app/components/studio/engine.ts` into a shared package
   file. The website keeps using it as it does now, and a build step copies it into the Android module's assets. Then
   both engines run the same shader text, and the website's `studio-shader` test keeps guarding it.
3. **Native GPU passes from those shaders.** In Kotlin, one Media3 `GlEffect` (a `BaseGlShaderProgram`) per pass, with the
   same uniforms the website sets: picture effects, Curves and HSL, adjust (bri, con, sat, warm, hi, sh, hue, sharpen,
   vignette), the look (`GRADES`), 3D zoom, canvas patterns.
4. **The studio's shot settings in the spec.** The phone gets each shot's `cs` (and its keyframes `kx`) from the studio
   (`engine.tool("state")`) and sends them in the spec; the Kotlin passes read them per frame (keyframes as on the
   website, `kxAt`).
5. **Masks, chroma key, blend, boxes.** Mask shapes and chroma key as GPU passes. Video boxes (layers) as extra Composition
   sequences.
6. **The 44 transitions.** Two shots overlap for the transition's length. Media3 sequences don't overlap, so the
   transition is drawn by one GPU pass that reads the end of one shot and the start of the next.
7. **Texts as the studio draws them.** Its styles, fonts, entrances, exits, loops and keyframes, drawn per frame onto a
   bitmap overlay.
8. **Parity check.** A test that draws the same frames on the website and on the phone and compares them. Then the
   phone's export can move from the hidden studio page to the native engine.

Each step ships on its own: the live preview gets a little closer to the studio's look with each one, and the export
stays on the studio until step 8.
