# Shubix shared video engine

This workspace package is the platform-neutral editing model for the Web Studio and React Native editor.

## Included primitives

- Explainable AI director planning from shot quality, subject/face scores, motion, speech, highlights, beats and drops.
- Shared effect catalogue covering colour, cinematic looks, light, distortion, motion, stabilization and portrait treatment.
- Shared transition catalogue covering cuts, dissolves, fades, push/slide, zoom, whip, spin, glitch, luma and mask reveals.
- Typed keyframe tracks with interpolation and easing.
- Mask types, blend modes, text animation tool identifiers and audio post-production tool identifiers.
- A mobile-safe plan mode that excludes effects marked as high-cost / unsupported on mobile.

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

The returned plan is a decision model, not a renderer. The web renderer and native renderer must apply its trims, effects, transitions, masks and keyframes during preview and export. Keep preview and export parity as a release requirement.

## Integration status

The package is added as a workspace dependency to both app manifests. The existing Fast Studio remains the current rendering implementation; the shared director primitives are the foundation for migrating its decisions and native editor operations to one common plan. Do not expose a control as supported until preview, saved project state and exported MP4 all implement it.
