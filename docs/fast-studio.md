# Fast Studio (on-device editor)

`/studio` makes a finished, beat-synced Reel entirely in the browser: no upload, no server render, no container time.
It sits next to the existing server pipeline; nothing in `server/` changes.

## Steps

1. **Music**: the song is decoded with the Web Audio API and analysed in the page: FFT, drum/voice split by median
   filtering (HPSS), tempo, sudden rises and falls in loudness. That gives the shot list: DROP (big jump into a louder
   part), HIT (strong accent, only when the sound there is mostly drums, so a singer's syllable is not a cut), BREAK
   (the sound falls and stays down) and plain cuts, each placed one frame before the beat.
2. **Clips**: each clip is played fast and sampled: motion and where it happens, scene changes, brightness, sharpness (Laplacian
   variance) and faces (tracking.js Viola-Jones, `public/vendor/tracking`, BSD licence). Clips can be added or removed
   at any time; reading is queued.
3. **Create**: every shot gets the best unused moment for its role (action for drops, calm for breaks, faces and sharp
   footage preferred, dark or blurry footage avoided). No moment of footage is used twice and the same clip is never
   used twice in a row. A shot never crosses a scene change in the clip, and a virtual camera follows the subject (see below).
   - **Style**: Auto (the music decides), Smooth (fewer, longer shots, soft camera moves, no flashy effects), Fast (a cut
     on every beat, a transition on every cut, punches and speed changes).
   - A zoom effect is only kept where it suits the shot: a close-up face or footage that already moves a lot gets a
     softer move, a long calm shot gets a slow move instead of a punch (the edit list says why).
   - Transitions (hard cut, flash, whip, zoom-through, spin, glitch, iris / wipe / bars masks, dip, dissolve), keyframed
     effects (ease curves), speed (slow, fast, velocity per beat, ramp, freeze), colour looks, film grain, light leaks,
     hook text, Instagram safe zones, loop ending: drawn by a WebGL shader (2D canvas fallback).
   - Timeline + edit list: change any shot's transition, effect or speed, or pick another moment (↻).
4. **Export**: frames are decoded and encoded with WebCodecs through mediabunny, off-screen and frame-accurate:
   H.264 + AAC in MP4 when the browser can encode them (Chrome / Edge on Windows and macOS, Safari 17+), otherwise VP9 +
   Opus in WebM; browsers without WebCodecs fall back to real-time recording (MediaRecorder).

## Beat accuracy

Beats come from a tracker that follows the tempo (not one fixed grid): tempo per 8 s window, one decision for the whole
song on the metrical level (a 72 BPM song is not heard at 144 when the in-between hits are only hi-hats; drum & bass keeps
174 because its snare lands half-way), then dynamic programming (Ellis 2007) anchored on the kick, then snare.
Scored with `scripts/studio-beats` (F-measure, ±70 ms):

| Test song | before | now |
|---|---|---|
| Drums 100 / drums + melody 128 / off-beat 140 | 98-99% | 100% |
| Tempo change 95 -> 128 | 64% | 100% |
| Live feel, drift 108 -> 114 | 59% | 100% |
| Slow 72 (was heard as 144) | 65% | 100% |
| Fast 174 (was heard as 87) | 65% | 100% |
| Unseen set: 4-on-the-floor 124, swung hip-hop 90, reggaeton 95, trap 70, piano only 100, drift 120 -> 126, change 140 -> 100 | - | 100% each |

These are synthetic songs; real mixes are harder, so keep comparing against the server (Beat This!) on real music.

## Scene changes inside a clip

A long video often holds several scenes. A shot that runs across one shows a flash of the wrong scene, so scene changes
are found while the clip is read and no shot may cross one (with a few frames of margin):

- **Hard cuts**: colour histogram change between samples, with an adaptive threshold (a spike far above the change
  around it, so a fast pan is not a cut). A flash or something passing through the frame returns to the same picture
  and is ignored. Each cut is then pinned to about one frame by seeking (bisection).
- **Fades** through black or white: the whole fade is covered, from where the brightness starts to slide.
- **Dissolves**: a short stretch of steady change between two still stretches, where the middle frame is a pixel blend of
  the two sides (a camera pan is not).
- The burst of "action" a cut causes in the motion numbers is removed, so a cut is never chosen as the best action moment.

Scored with `scripts/studio-scenes`: 5/5 found, cuts within one frame, no false ones on 7 clips, 0 shots across a boundary.

## Camera that follows the subject

Cropping a landscape clip to 9:16 keeps only a third of the width, so a fixed crop easily loses the subject. Each shot
now gets a camera path, like a camera operator:

- **Where the subject is**: the face (tracked through the clip: a lone detection is dropped as a false face, and with
  several faces the one already followed wins), else what moves on its own with the camera's own motion removed (global
  shift by block matching), plus what stands out in the picture (colour-contrast saliency), so a subject standing still
  is found too.
- **How the camera moves**: it stays locked when the subject stays near the middle (most professional shots are locked
  off), pans slowly and smoothly when it moves away, and never twitches: positions are smoothed in both directions in time,
  so there is no lag and handheld shake is not copied. Faces sit 40% from the top. The path is in footage time, so slow
  motion and speed ramps follow the same subject.
- The edit list says per shot whether the camera follows a face, follows the subject or is locked on it.

Measured on a subject that stands, walks across a landscape frame and stops (9:16 crop): subject in frame 100% of the
time (the best fixed crop: 12-45% on the shots where it walks), camera jerk about 0.3 px/frame², 2 ms for all 48 paths.

Clip reading now runs the action pass and the face pass at the same time: 5 clips read in 36 s instead of 47 s in the
test browser.

## Smoothness

- The song is analysed in a Web Worker: the page never freezes (0 ms main-thread blocking measured; it was one long block).
- Shot scoring uses prefix sums (O(log n) per window), so long videos no longer stall the edit.
- The live preview draws at half size (540×960) and catches up gently (small speed nudges instead of jumps); the shot
  after next is cued in advance. Export and the cover still use the full 1080p.
- Export: each frame is taken from the middle of its source frame (no duplicated / skipped frames from rounding), a frame
  belongs to the same shot in decoding and drawing, and every window keeps 0.15 s of clip after it. Measured on a test
  export: 0 frozen frames in 449 normal-speed frames (was 8), no audio gaps, audio/video offset 6 ms.

## Speed

Measured in a headless Chromium with no GPU (software WebGL, software VP9): music 22 s analysed in about 2 s, six clips
read in about 1-2 s each, export ~0.56 s per frame, almost all of it the software shader (decode 23 ms, encode 3 ms per
frame). With a real GPU the shader takes a few milliseconds, so the export is expected to be faster than real time;
measure on your target phones before promising numbers.

## Files

- `app/studio/page.tsx`: the page (loads the face finder, mounts the editor)
- `components/studio/engine.ts`: the editor (plain JS ported from the standalone prototype, `@ts-nocheck`)
- `components/studio/markup.ts`, `components/studio/studio.css`: its markup and styles (scoped under `.brs`, app theme tokens)
- `public/vendor/tracking/`: tracking.js 1.1.3 and its face classifier
