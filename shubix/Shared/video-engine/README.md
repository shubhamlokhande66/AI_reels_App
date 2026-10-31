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
- Overlay photo/video layers with position, scale, rotation, opacity, layer timing, shape masks, feather/inversion, chroma key and blend modes
- Text-to-speech voice tracks at the playhead and automatic captions with language, translation and animation-style controls
- Keyframe insertion, easing selection, previous/next navigation, delete and clear controls at the current playhead
- Keyframe persistence in the shared Reel project schema and native preview interpolation
- Preservation of Studio-only clip settings and keyframes when native changes are synced back before export

Some advanced Studio-only adjustments are previewed by the Studio renderer rather than reproduced identically by Expo's native video surface. The native layer inspector controls the existing Studio layer compositor; it does not implement a separate native GPU compositor. Export for a Studio-originated Reel must continue through the Studio engine; do not silently fall back to the basic native exporter if Studio sync is unavailable.

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


## Complete editor tool catalogue

The shared package also exports `EDITOR_TOOL_CATALOG`, `getEditorTools` and
`resolveEditorToolAvailability`. The catalogue covers basic, advanced, pro and
trending tools across clip editing, timelines, motion/keyframes, speed, color,
effects, transitions, masks, layers, text, captions, audio, AI and export.

Important support rule: catalogue presence is not proof that a renderer can render
a feature. Each item carries an explicit status:
- `ready`: available in the shared editor workflow.
- `studio-only`: available only while the Reel's Shubix Studio session is active.
- `preview-only`: preview support exists but export parity is not complete.
- `planned`: listed for product planning, but must remain unavailable in the UI.

Before showing a tool, pass the active platform and renderer/session capabilities to
`resolveEditorToolAvailability`. Do not silently drop unsupported edits or export a
visually degraded Reel. In particular, person segmentation, arbitrary freehand masks,
object tracking, advanced optical-flow slow motion, and several GPU-heavy looks remain
gated until both preview and export are implemented and tested.


## Autonomous AI Reel Creator

`createAutonomousReelPlan` is the shared autonomous editorial planner used by Fast Studio.
It consumes pre-analysed source moments and music analysis, then returns a validated edit
decision: hook, establishing/hero/action/detail/reaction/ending roles, source trims,
timeline placement, beat-aware transitions, renderer-registered effects, motion keyframes,
caption suggestions, decisions and warnings.

The planner is deterministic and does not decode video, call a cloud model or render media.
The platform pipeline is responsible for local media analysis (scene/subject/face/motion/
quality/speech), audio analysis (BPM/beats/downbeats/drops/quiet sections), and applying
the plan to the active renderer. This separation keeps the same editorial decisions
available on Web and Android while preserving device-specific rendering budgets.

Before export, call `validateAutonomousReelPlan`. A plan that fails validation must not
be exported; the current Fast Studio integration falls back to the existing safe scorer.
The planner avoids repeating source moments, protects speech, prefers scene/subject
diversity, selects an intentional opening and ending, and limits effects to the active
platform's GPU budget.

Autonomous workflow target:
1. User selects an audio track and source videos (optional instruction or mood).
2. Local analysis extracts scene moments, subject/face/motion/quality/speech signals.
3. Music analysis extracts tempo, beat/downbeat grid, drops and quiet ranges.
4. AI Director creates and validates the complete edit decision.
5. Renderer applies trims, sequencing, transitions, effects, keyframes, text/captions and mix.
6. Quality gate checks missing media, black frames, audio clipping, duration and export parity.
7. Preview and export the final MP4; user can optionally refine it in the manual editor.

No unsupported renderer capability should be silently simulated or presented as export-ready.


Automatic mood inference uses `inferAutonomousMood` when no user instruction is supplied.
It can classify product, food, travel, fashion, talking, wedding, devotional, energetic
and story-led footage from the structured signals provided by local analysis.

The shared quality gate `assessAutonomousRenderQuality` evaluates decoded frame samples,
black/missing frames, blur/repetition, duration, dimensions/FPS and audio clipping/silence.
It returns pass/warn/fail plus specific repair hints. The renderer must collect those probes
and run this gate before marking a generated Reel complete; a recommendation is not itself
an automatic repair or a substitute for a second render.

## Advanced shared editing utilities added on `chatGpt`

The platform-neutral package now also provides deterministic timeline helpers:
- `rippleDelete`: remove a selected timeline interval, split crossing clips and close the gap while preserving source-time mapping.
- `rippleInsert`: insert a gap and split/move affected clips without losing their source ranges.
- `slipClip`: change a clip's source window while preserving its timeline placement.
- `evaluateMotionPath`: sample cubic-Bezier motion paths with endpoint clamping.
- `buildDuckingEnvelope`: create a bounded attack/hold/release gain envelope for audio-mix consumers.

The shared RenderJob contract now carries music gain, fade-in, fade-out and optional ducking metadata. The Android adapter maps these fields to the existing Media3 gain processor and preserves per-clip source gain up to 100%. It rejects unsupported timeline placement or gain values instead of silently changing them.

The shared Android adapter still deliberately rejects speed-ramp and shot-keyframe projects until those project fields are represented losslessly in the versioned RenderJob contract. The app routes those projects through the existing native export path, which already consumes the editor's speed-ramp and compact transform-keyframe data. This is a compatibility boundary, not a claim of full cross-renderer parity.



## Android Media3 Phase 2 implementation boundary

The primary Android native export path maps Fade in, slide, zoom, spin, whip-pan, blur and flash presets to timestamp-scoped Media3 effects, and supports blur pulse, brightness, contrast, saturation and hue. It maps the native filter presets and audio mix settings. These are implemented on the native export path; verify on physical devices before marking release parity complete.

Dissolve/crossfade, directional wipes, 3D transitions, arbitrary masks, additional compositor layers, animated layer transforms and advanced GPU looks are still not claimed as Android-export-ready. The adapter explicitly rejects unsupported transitions, masks, layers, animated effects and text treatments instead of dropping them. Shared keyframe curves are sampled with cubic-Bezier timing; project keyframes continue to use the existing native export path until the versioned adapter maps them losslessly.

The Android shared-render adapter also maps the mobile motion presets punch, soft punch, zoom burst, snap, hook zoom, jump, bounce, tilt, pan/drift, shake and heartbeat to sampled transform keyframes. These native presets are a device-side implementation; visual parity with Studio still requires the release checklist on real hardware.


### Android transition support boundary

The primary Android export path now maps editor Fade, Zoom, Blur and Flash presets plus supported Studio fade-in, slide, spin and whip-pan presets into native Media3 effects. Blur and Flash use timestamp-scoped GPU effects. Slide/zoom/spin/whip are incoming transform animations, not two-clip overlap transitions. True Dissolve/Crossfade, Push and Wipe are not claimed as supported because Media3 Transformer 1.8.0 does not provide native video-track crossfading; those edits must be rejected or rendered by the browser Studio path until a dedicated compositor is available.


### Web Studio layer compositor

The browser Studio renderer composites overlapping video/photo layers with crop, transform, opacity, blend modes, chroma key, fade-in/out and layer masks. Layer masks include ellipse, rectangle, polygon, linear, radial and luma modes with feather and inversion; the luma threshold has its own control. Studio-originated Android drafts must continue exporting through their held Studio session so these layer operations survive. The native Android editor preview is not claimed to display the full Studio compositor.

Android native export now composites all simultaneously active text overlays into a single timed bitmap layer instead of returning only the first matching overlay. Studio-originated projects still use the browser renderer for the full text/caption animation system.
