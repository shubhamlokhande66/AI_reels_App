# Fast Studio (on-device editor)

`/studio` makes a finished, beat-synced Reel entirely in the browser: no upload, no server render, no container time.
It sits next to the existing server pipeline; nothing in `server/` changes.

## Steps

1. **Music**: the song is decoded with the Web Audio API and analysed in the page: FFT, drum/voice split by median
   filtering (HPSS), tempo, sudden rises and falls in loudness. That gives the shot list: DROP (big jump into a louder
   part), HIT (strong accent, only when the sound there is mostly drums, so a singer's syllable is not a cut), BREAK
   (the sound falls and stays down) and plain cuts, each placed one frame before the beat.
2. **Clips**: each clip is played fast and sampled: motion and where it happens, brightness, sharpness (Laplacian
   variance) and faces (tracking.js Viola-Jones, `public/vendor/tracking`, BSD licence). Clips can be added or removed
   at any time; reading is queued.
3. **Create**: every shot gets the best unused moment for its role (action for drops, calm for breaks, faces and sharp
   footage preferred, dark or blurry footage avoided). No moment of footage is used twice and the same clip is never
   used twice in a row. The crop follows the face, else the action.
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
