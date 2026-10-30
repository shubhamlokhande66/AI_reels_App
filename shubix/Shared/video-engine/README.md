# Shubix shared video engine

The shared workspace package is the platform-neutral decision and editing model used by Fast Studio (Web) and the Android editor. It intentionally does not replace the current WebGL/WebCodecs renderer: the existing Studio renderer remains the export source of truth for generated Reels.

## Shared AI director

`createDirectorPlan` builds an explainable first-pass edit from:
- Shot quality, motion, face/subject score, highlights and speech flags
- Music beat grid and drop positions
- Target duration, aspect ratio, mood, intensity and mobile constraints
- A ranked, non-repeating source selection with cut reasons and camera keyframe tracks

Fast Studio now runs this shared planner as a local fallback. It adds a soft preference to the existing frame/window scorer and applies only renderer-supported motion effects when the cloud AI director has not supplied explicit choices. The music timeline and explicit AI shot choices remain authoritative.

## Shared editing primitives

- Typed keyframe tracks and easing, with numeric and compact Studio transform interpolation shared by web and Android
- Mask definitions: rectangle, ellipse, linear/radial, freehand, person, luma and text
- Blend mode catalogue
- Effect catalogue for colour, cinematic looks, light, distortion, motion and portrait treatment
- Transition catalogue with IDs aligned to the current Studio renderer
- Audio and text tool catalogues
- Mobile-safe effect metadata for choosing a device-friendly subset

## Android integration in this PR

The native editor now connects to the hidden Fast Studio page through the existing bridge for:
- Renderer-backed transition and effect changes
- Colour adjustment presets
- Speed curve presets, stabilization, beauty, fades, mosaic, magnifier and borders
- Keyframe insertion, easing selection, previous/next navigation, delete and clear controls at the current playhead
- Keyframe persistence in the shared Reel project schema and native preview interpolation
- Preservation of Studio-only clip settings and keyframes when native changes are synced back before export

Some advanced Studio-only adjustments are previewed by the Studio renderer rather than reproduced by Expo's native video surface. Export for a Studio-originated Reel must continue through the Studio engine; do not silently fall back to the basic native exporter if Studio sync is unavailable.

## Use

```ts
import { createDirectorPlan, evaluateKeyframes } from "@shubix/video-engine";

const plan = createDirectorPlan({
  shots: analysedShots,
  beats: beatTimes,
  drops: dropTimes,
  targetDuration: 30,
  aspect: "9:16",
  mood: "cinematic",
  mobile: true,
});
```

## Release requirements still to verify

- Run workspace typechecks and Vitest in CI.
- Test Android device builds (not Expo Go), including long 1080p/4K source clips and low-memory devices.
- Compare native preview with the Studio MP4 for transitions, keyframes and each effect.
- Validate mask tracking, object/person segmentation, high-cost GPU effects and layer compositing on real devices.
- Keep unsupported controls hidden or clearly unavailable until both preview and exported MP4 implement them.
