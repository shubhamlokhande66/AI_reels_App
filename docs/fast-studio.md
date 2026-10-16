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

Two beat trackers, each strong where the other is weak, both on the phone:

1. **The studio's own tracker** (instant, in a worker): tempo per 8 s window with one song-wide metrical-level decision,
   then dynamic programming on the kick / low end / drums that follows that local tempo firmly (tightness 1600: the
   tempo is accurate, so the beats keep it through syncopated fills), then every beat is moved onto its own attack: a
   fine onset function (2.9 ms steps, whole spectrum) aligns the grid locally (at most 12% of a beat, so never onto the
   next triplet or 16th) and snaps each beat within 25 ms. Leading / trailing stretches with no pulse (a free-time
   intro) get no beats.
2. **Beat This!** (Foscarin, Schlueter & Widmer, ISMIR 2024), the neural network the server already uses, now also on
   the phone: the same 8-bit model (23 MB, downloaded once and kept in the browser) and the same pre- / post-processing
   code (`lib/beatThis/core.ts`, shared with `server/audio/beatThis.ts`), run with ONNX Runtime WebAssembly in a worker
   (`lib/beatThis/beatThis.worker.ts`). On the phone it gives the server's beats exactly (50/50 and 141/141 within one
   frame on the two real songs). The studio page is cross-origin isolated (`next.config.ts`) so it can use several cores
   (1.8x faster on 2 threads; up to 4 on a phone).

The edit is made at once with (1); (2) runs in the background and the analysis then keeps whichever beats land on
stronger hits (every band, hats at half weight) with a steadier pulse; when the two count at 2:1, the in-between beats
of the faster one decide (real hits there, like a snare on 2 and 4, make it the beat). The edit follows if it changed.
Devices without WebAssembly SIMD or with under 2 GB of memory keep (1).

Why both: on the real songs (no annotation; essentia's multi-feature tracker, librosa and Beat This! compared, and where
the hits actually are measured per band) the old tracker was 55% / 49%: on ReelAudio its grid sat a third of a beat
early (an 808 that plays on and off the beat pulled it), where all three references agreed. Beat This! gets that song
right (99%) but on Video-454 it follows a syncopated pattern irregularly (60%) while the steady 120 BPM grid is right;
on garba 6/8 and bhangra swing it counts 1.5x too fast. Together they cover each other. Scored with `scripts/studio-beats`
(23 synthetic songs with known beats, each also degraded as a phone hears it; F-measure, ±70 ms):

| | set 1 | set 2 | set 3 (Indian rhythms) | sets 1 / 2 / 3, phone audio | real songs |
|---|---|---|---|---|---|
| before | 100% | 100% | 83.4% | - | 55% / 49% |
| **now** | **99.7%** | **100%** | **99.7%** | **98.5% / 89.1% / 99.7%** | **100% / 99%** |

Synthetic songs are still not real mixes; keep comparing on real music (the edit list and the waveform show the beats).

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
- `lib/beatThis/`: Beat This! shared core (also used by the server), the worker and its client; `app/api/studio/model/`
  serves the model; `scripts/copy-ort.mjs` puts ONNX Runtime's WebAssembly in `public/vendor/ort/` before dev / build

## AI picks the best moments (optional)

A switch under Style, shown only when the server has a vision model set up (Settings → AI; the task is "Fast Studio: AI
shot picking", so it can use its own provider). It is remembered per device.

- The phone sends 3-8 small frames per clip (384 px JPEG, about 7 KB each; the sharpest well-lit moment of each part of
  the clip, never on a scene change). One request per Reel, clips scored in parallel on the server through the app's AI
  layer (provider routing, fallback, budget limit, usage log).
- For each frame the model says how strong it is as a Reel shot (0-1), what it suits (hook, action, calm, detail, ending),
  what is wrong (blur, dark, eyes closed, view blocked…), where the subject is and a short note. Answers are bounded and
  checked before use (`server/studio/rankShots.ts`).
- The phone keeps every timing decision. The AI's opinion is added to each candidate moment (same scene only): strong
  moments win, the hook slot prefers "hook" moments, drops and hits "action", breaks "calm", the last shot "ending". The
  subject box also steers the camera crop. The edit list shows the AI's note per shot.
- The opening shot is now chosen first (before drops and hits), so it gets the best moment.
- Scores are cached per clip on the device: switching it off and on, a new mix or a new style cost nothing.
- If the AI is unavailable the edit simply stays on the on-device picks, with a message.
- Cost: one request per Reel (about 20-40 small low-detail images): roughly ₹0.3-1 with a small vision model. Credits per
  Reel are set in the admin pricing (`studio_ai`, 0 by default).

Measured with a stand-in model that knows which footage is good (3 runs): opening / drop / hit shots on the good footage
70-86% with AI against 27-45% without; the opening shot was a top moment every time; 23 frames in one 212 KB request.

## AI director (with AI picks on)

After the AI has scored the clips, one text call (no images, about 10-20 KB) plans the Reel as a story. The music has
already fixed every cut time; for each cut the phone offers the moment it has now plus up to 2 alternatives taken from
footage no other cut is offered, so any combination fits together. The director (`server/studio/direct.ts`, task
"Fast Studio: AI director") picks one moment per cut plus its transition, effect and speed, with a short reason, guided by
how top Reels editors work (hook first, build to the drops, calm breaks, a satisfying ending, variety, special
transitions only where they mean something, within a ration).

Every choice is then checked on the phone, and whatever fails keeps the rule choice:
- the moment must be one that was offered, still free (footage used once), inside one scene, not the same clip as a
  neighbour; the director's moments are held for their own cuts;
- transitions must suit the style (Smooth: hard cuts, dissolves, dips), break cuts stay calm, and a final pass over the
  whole edit keeps special transitions within their ration (the director's first), well inside both shots, and never
  the same one twice in a row (this pass now also protects the edits made without AI);
- effects must suit the cut (the hook zoom only on the first shot, a photo snap only on a long drop, slow moves only on
  shots long enough, Smooth stays soft), and close-ups still get gentle zooms;
- speeds must fit (Smooth: normal or slow; velocity needs a beat inside; ramp needs a long shot; freeze only with a snap).

The status line says how many of the director's choices were used and how many the rules changed, plus the story in one
line; the edit list shows the reason per shot. One plan per style / mix / clip set, cached: switching back costs nothing,
a new mix asks again. If the director is unavailable the edit keeps the AI-scored picks.

Measured with a deliberately pushy stand-in director (whip pans on every hit, an unknown transition, a freeze without a
snap, glitches and shakes in Smooth): 33/36 moments used in Auto and 13/13 in Smooth, every bad choice corrected, and
0 footage used twice, 0 scene crossings, 0 same clip back to back, 0 transitions longer than their shot, 0 repeats, rations
kept; one director call per edit, no retries when it is down.

## Copy a Reel

Style → **Copy a Reel**: upload a Reel you like; it is read on this device and its style is put on your song and clips.

What is read (`analyzeReference`):
- **Cuts**: the scene-change reader of the clips (now also brightness and layout, so black-and-white and same-colour
  cuts are found; a change of grain or compression on a flat picture is not a cut), frame-accurate.
- **Transition at each cut**, from the frames around it, decoded in one pass with WebCodecs: flash (a white spike),
  fade (through black), whip pan (a big sideways jump and horizontal blur), zoom-through (a fast scale-up), dissolve
  (the frames between are blends of both pictures), or a hard cut.
- **Pace in beats of its own song** (so it carries over to a song at another tempo), whether it cuts on the beat, the
  hook length, and whether the pace rises; **zooms inside shots** (scale measured together with a small shift, so a
  drifting shot is not a zoom).
- **Look**: brightness, contrast, saturation, warmth, teal-orange split, black and white, faded blacks, vignette, grain.

How it is applied: the cuts follow its sequence of shot lengths on this song's beats (the drops of this song stay cut
points); its transitions are used in the same shares (flashes, zooms and whips on the drops and hits, dissolves and
fades on the calm shots) and its zooms on the same share of shots; the look is **matched on the edit itself**: a few
frames of the edit are rendered and measured like the reference, the grade (contrast, saturation, brightness, warmth,
teal-orange, black and white, lifted blacks, vignette, grain) is corrected and measured again. With AI picks on, the AI
still chooses the moments; the AI director stays out (the reference is the plan).

Scored with `scripts/studio-style` (four reference Reels with known cuts, transitions and grades): cuts found 96-100% of
78, transition type right 99-100%, pace 4/4, no false zooms; applied, the transition shares are within a few percent
(100% dissolves stay 100%) and the rendered look lands within about 0.01-0.05 of the reference's numbers.

## Text: the hook on the beat, captions of the song

- **Hook text** now appears word by word, one word on each beat from the start, each popping in, and pulses on the
  beats while it is up.
- **Captions** (shown when the server has speech recognition: local Whisper, or OpenAI's Whisper API with
  `OPENAI_API_KEY`): the words of the song (lyrics or speech), word by word on the times they are sung. The phone sends
  the song once as a small 16 kHz mono WAV of the vocal band (`/api/studio/transcribe`, language: detect, Hindi,
  Marathi, English, …), the words are cached per song and language, and broken into short lines at pauses.
- **Styles**: Pop (each word pops in when sung), Karaoke (the line is shown, the sung word lights up), Box (words on
  coloured boxes), Clean.
- **Placement**: inside Instagram's safe area (its top 220 px and bottom 450 px of 1920 are its UI); captions move up
  when a face is in their band (the tracked face of the shot); Hindi / Marathi are drawn in Devanagari with a font that
  shapes them. The text is part of the frame, so the export has it.
- Credits per song: `studio_captions` in the admin pricing (0 by default).

Checked with `scripts/studio-text/check-text.cjs` on the rendered frames: text only while a line is sung, a word more
on each beat for the hook, the Devanagari line drawn, captions moved above a face.

## Export that survives a phone

- **The screen stays on while exporting** (Screen Wake Lock): a phone that dims and locks halfway would stop the page
  and the export with it. The lock is taken again when the page comes back from the background and let go at the end.
- **No timers in the export loop**: it yields to the page through a MessageChannel / `scheduler.yield` (a hidden tab
  throttles `setTimeout` to once a second or less), and the page's own per-frame updates (progress bar, edit list) are
  skipped during the export; it shows progress and the time left every 15 frames.
- **The GPU may be taken away** (memory pressure, the app in the background): frames are then drawn by the 2D renderer
  until the WebGL context is restored, which sets everything up again. Never a black frame.
- **The next shot is already seeking** while the current one is drawn (two decoders per clip, alternating shots): phone
  video has a keyframe only every 1-2 s, so the seek is the slow part of a cut. Decoded frames go into a small ring of
  reused canvases.

Measured in the test browser (software GPU): decoding 15-19 ms per frame instead of 23 ms; the GPU taken away at 25% of
an export and given back 2 s later: 24 frames drawn by the 2D renderer, 0 black frames, the export completes; no frame
repeated by the pipeline. Drawing there is software-emulated (~0.5 s per frame); on a phone's GPU it is a few ms, so the
decode and seek savings are what shows. Not yet timed on a real phone.

## iPhone

- **Videos from an iPhone are read even though Safari would not load them.** iPhone Safari loads only a video's metadata
  until it is played (`preload` is ignored), so a clip that never played had no picture: reading it timed out and the
  clip showed "does not play here (format)". Clips are now read from frames decoded with WebCodecs (mediabunny): the
  same frames on every browser, HEVC 10-bit and rotated portrait .MOV included, in order, at fixed times (every 1/30 s for
  short clips, at most every 0.2 s). Without WebCodecs a video element is used, played muted for a moment first, which
  Safari allows without a tap. The preview's videos get the same treatment before they are drawn.
- **Any file with sound is a song.** Safari cannot decode the sound of a QuickTime .MOV (every iPhone video, a saved
  Reel, a screen recording): its sound track is copied, unchanged, into a small .m4a that it can decode. Videos over
  60 MB are never read whole. Songs in the Apple Music app are protected; websites cannot open them (the message says so).
- **Sound with the silent switch on**: the page declares it plays media (Audio Session API), so the ring/silent switch
  does not mute the preview.
- **Export on iOS 16.4-18** (WebCodecs video, but no AAC encoder): a WebAssembly AAC encoder (`@mediabunny/aac-encoder`,
  loaded only then) keeps the file an H.264 + AAC MP4. At most 4 decoders are alive during an export, and old last
  frames are freed: iPhone Safari caps the memory all canvases of a page may use.
- **Saving on a phone**: a "Save video to Photos / Share" button opens the share sheet (Save Video, Instagram...); a
  download would land in Files, where Instagram cannot see it.

Checked in Safari's engine (WebKitGTK 2.52) with the iPhone's media rules switched on, on iPhone-style files
(`scripts/studio-iphone`): every clip read in full (before: a 12 s clip gave 6 samples instead of 360), the cuts inside
an HEVC 10-bit rotated .MOV found 23 of 23 within 2 frames, a .MOV as the song, and an H.264 + AAC MP4 export with the
WebAssembly AAC encoder. Chromium: scenes 5/5 exact, 0 crossings, subject in frame 100%. Not yet checked on an iPhone.

## Reel length (a part of the song)

**Full song, 15 s, 30 s, 1 min or any length (5-180 s).** The Reel uses only that part of the song.
- **Auto ("Best part"):** the part that is full and loud, has the drop in its first 40% (a hook in the first seconds), does not start quietly or on a break, and starts on a hard beat; the earlier of two equal choruses.
- **By hand:** drag the lit window on the waveform; it snaps to the nearest beat when let go.
- The whole song is analysed once; a part is cut out on whole beats (whole bars when that costs at most one beat), so it
  keeps the whole song's beat grid (AI-checked included); drops and breaks keep the whole song's judgement (a part's
  first beat has nothing before it to be a drop against). 6 ms fade in, a short fade out.
- Captions: the whole song is transcribed once (up to 3 min, from the part when it starts later) and each part takes
  its words from that: changing the part sends nothing to the server.

Checked (`scripts/studio-length`, a song with a known structure: quiet intro, verse, drop at 24 s, break, second chorus at
48 s): 15 s and 30 s start on the drop at 24.0 s; 20 s on the second chorus at 48.0 s; a drag to 50.2 s starts at 50.0 s
(the beat); the part's first beat at 0.000 s; 1 transcription for all parts; the export of a 15 s part is 15.00 s.
On a real song with an even loudness, the part chosen (0:17) is among the loudest 15 s windows (0:16-0:18).

## Talking videos (talking head, vlog, tutorial)

"What are you making?" → **Talking · vlog · tutorial**. The clips' own voice is the sound of the Reel; a song is optional.
- **Where people speak**: Silero VAD v6 (MIT, 1.3 MB, `server/audio/data/vad`, served by `/api/studio/model`) in a worker
  (`lib/vad`), on 16 kHz sound, a probability every 32 ms; loudness (10 dB over the clip's quiet floor) when it cannot run.
- **Pauses**: Tight / Natural / Relaxed / Keep all. In above 0.5, out after 0.2 s below 0.35; padded (Natural: 0.12 s
  before, 0.2 s after) and pauses shorter than 0.42 s kept, so sentences breathe.
- **Shots**: one per spoken part, in the clips' order; parts over 5 s split at their quietest moment; a jump cut inside one
  take gets a punch-in (framed 14% closer); framing follows the face.
- **Sound**: the voice parts end to end with 8 ms fades, every clip at one loudness; the song's best part (repeated if the
  talk is longer) under it at Soft / Medium / Loud, stepping back while someone speaks (80 ms down, 400 ms up). This one
  track is the edit's audio: preview, captions (the voice alone is transcribed) and export use it.

Checked (`scripts/studio-talk`: English, Hindi and Marathi clips spoken by espeak-ng with known pauses and room noise):
100% of the speech kept with every setting; the long pauses (≥1 s) cut to the 0.3 s of breathing room (21% left with
Natural, 14% Tight, 30% Relaxed); 41.7 s of clips → 29.5 s of talk; voice and picture in sync (correlation 1.00 at 0 ms
on every shot); music 17 dB under the voice (Medium); captions get the 29.5 s voice; export 29.56 s. Silero alone: 96.6% /
99.7% / 99.0% of the speech found (English / Hindi / Marathi), under 0.1 s for 19 s of sound. Safari's engine (WebKitGTK,
iPhone media rules): the same edit (29.6 s, 9 shots, AI detector). Not yet checked on real phones or real voices.

## Text & stickers

"+ Text", "+ Sticker" (20 emoji) and ready-made items: a price tag (₹), Follow / Save prompts (the last 3 s), Step 1,
BEFORE / AFTER, गणपती बाप्पा मोरया, शुभ दीपावली, Happy Diwali (the whole Reel). Each item has its words, a style
(Bold outline, Box, Neon, Clean, Tag), one of 7 colours (the text on a box picks black or white for contrast), an entrance
(Pop, Fade, Slide up, Typewriter, None; a 0.15 s fade out), a size, and a time: "Start here" / "End here" at the paused
preview, or the whole Reel. Drag an item on the preview to move it; it is kept inside Instagram's safe area. Drawn into
the frame (the export has it); Devanagari through the same font stack as captions. The preview only takes touches for
dragging when there are items, so the page still scrolls over it otherwise.

Checked (`scripts/studio-text/check-overlays.cjs`): a Marathi box text set to 1.0-4.0 s draws only then (ink 0 at 0.5 and
4.3 s, 0.88-0.89 between); dragged a quarter of the screen down, it moved by exactly 0.25; pushed to the bottom it stops
at 0.766 of the height (Instagram's bar starts at 1 - 450/1920 = 0.766); the price tag's yellow fills 57% of its box in
the exported video's frames.

## Faces and the background (MediaPipe models on the phone)

Two Apache-2.0 MediaPipe models, converted to ONNX (`server/vision/data`, see its README) and run by ONNX Runtime Web in a
worker (`lib/vision`), the runtime the beat and speech models already use:
- **Faces: BlazeFace short range** (418 KB) instead of the old Viola-Jones finder (kept as the fallback). Each look: the
  whole frame fitted into 128x128, plus squares as wide as the frame along its long side (top / middle / bottom of a
  vertical video, where a face has twice the pixels); finds merged. Feeds the subject-following crop, caption placement
  and talking-video framing as before.
- **Person mask: Selfie Segmentation** (450 KB; MediaPipe's custom transposed convolution rewritten as ONNX
  ConvTranspose). "Background": Original / **Blur** / **Colour** (6) / **Photo** (your picture, cover-fitted); and a text
  can be put **behind the person**. Computed on the finished frame (letterboxed into 256x256, which matched a square
  photo's mask better than stretching: IoU 0.852 vs 0.832), just before the text. The preview uses the mask of the frame
  before; the export computes each frame's own.

Checked (`scripts/studio-vision`, vertical clips of a real person with the face's position known): BlazeFace found the
face in 15/15 looks in both clips, 1.1% and 0.6% of the width from the true centre (Viola-Jones: 46.4%, on a false face,
and 6.0%). Green background: 100% of the background corners green, 0% of the face, the face's pixels unchanged; blur:
the corners' detail 5 → 0.2, the face unchanged; a text across the face: 41% visible over the face in front, 0% behind
the person, the same beside it; the exported video: corners green, face not.

## Saved Reels (on the phone)

Every Reel is saved on the phone a few seconds after anything changes (IndexedDB, which every browser has; nothing is
uploaded): its song and clips (each file once, shared by the Reels that use it), the settings, the exact edit (each
shot's moment, transition, effect and speed; talking videos are rebuilt from their settings), the texts, the part of the
song and the captions already transcribed. "Your Reels" lists them with a thumbnail; opening one reloads the page into
it; × deletes it and the files no other Reel uses. The browser is asked to keep the storage (`navigator.storage.persist`).
Note: iPhone Safari may clear a website's storage after 7 days without a visit unless the site is added to the home screen.

Checked (`scripts/studio-projects`): a Reel with a hand-picked 15 s part, the Cinematic look, a text, a transition changed
by hand and captions, left and opened again: the same 21 shots, the same transition, text, part and look, the same picture
at 3.3 s (pixel hash), no new transcription; deleted: no Reels and 0 files left.

## Voiceover

"🎙 Record voiceover" (music edits): the Reel plays from the start with the song softer while you speak; the microphone
(echo cancellation, noise suppression) goes through an AudioWorklet in the same audio clock as the song, so each captured
block is placed where it was heard (minus the output latency you reacted to). The voice is brought to about -14 dBFS
while speaking; the song steps back under it (to 0.22 within 80 ms, back to 0.75 over 400 ms). With captions on, the
voice is what is transcribed. "Remove voiceover" puts the song back. Saved with the Reel.

Checked (`scripts/studio-voiceover`, Chromium with a WAV as the microphone): 14.98 s recorded on a 15 s part; the song
measured at 0.29 of its level while the voice speaks and 0.64 in the pauses; captions sent the 14.98 s of voice; the
exported sound matches the Reel's mix (correlation 0.994, 6 ms: the Opus encoder's delay); saved and opened again:
the same voiceover.

## Templates

"Or start from a template": 🗣 Talking head, 📚 Tutorial, 🍲 Recipe, ✨ Before / After, 🛍 Product, ⚡ Beat montage,
🧳 Travel, 🌺 Ganpati, 🪔 Diwali. One tap sets the kind (music edit / talking), the edit's pace, the look, the text style,
the length of the song (15 s / 30 s), captions (talking), pauses and music level (talking), and places the template's texts
on the finished edit at its final length: steps at the thirds of a tutorial, BEFORE / AFTER at the halves, the price
(from 35% of the Reel) and "DM to order" (the last 3 s) on a product, a greeting for the whole festival Reel. Chosen
before the media, it is applied when the edit exists; choosing another replaces its texts. Everything stays editable.

Checked (`scripts/studio-templates`): Product chosen before the media → a 15 s Reel with "New arrival" 0-2.4 s, the price
5.24-11.98 s, "DM to order" 11.98-14.98 s; Before / After on that edit → BEFORE 0-7.49 s, AFTER 7.49-14.98 s (the
product texts gone); Recipe → 30 s (29.95), smooth, box style, its two texts; Tutorial with talking clips → talking, tight
pauses, Step 1 / 2 / 3 at the thirds of the 20.84 s talk.

## Voice noise cleanup

"🧹 Clean up voice noise" (talking videos and voiceovers, on by default): RNNoise (Xiph, BSD; the `@shiguredo/rnnoise-wasm`
WebAssembly build, Apache-2.0, loaded only when needed) over the voice in 10 ms frames at 48 kHz, its one-frame delay
taken out. Run once per clip and on a voiceover, before the pauses are looked for. The switch changes which voice the
Reel uses (the original stays); the saved Reel keeps the original recording.

Checked (`scripts/studio-talk/check-denoise.cjs`, a talking clip with traffic rumble, hiss and horns 12 dB under the
voice): the noise in the pauses went from 12.7 dB to 86 dB under the voice (silence); the voice against the clean
recording, in the speech: 0.972 without, 0.973 with (no damage to the voice; RNNoise lowers noise most where nobody
speaks); with Natural pauses in that noise, 100% of the speech kept.

## Captions for talking: key words and zoom punches

In talking videos and voiceovers (captions on, "✨ Key words + zoom" on by default) one word per caption line is the key
word: the one said hardest (its loudness in the voice) that is not a small word (English, Hindi and Marathi stop words),
longer words and numbers counting a little more. It is drawn in the accent colour, 16% bigger, with an emoji when one
fits (money 💰, tip 💡, mistake ❌, पैसा 💰, गणपती 🌺…), and the picture punches in 8% on it (0.12 s in, 0.6 s back). Song
captions are unchanged.

Checked (`scripts/studio-talk/check-keywords.cjs`): 8 lines, exactly one key word each, never a small word ("three",
"reels", "tip 💡", "start 👀", "keep", "short ✂️", "captions ✍️", "every"); the zoom 1.08 just after a key word, 1.00 0.9 s
later and on other words; accent pixels in the caption band at a key word, none before it; switched off: no key words,
no zoom.

## Translated captions (bilingual)

Under captions, "Translation": + मराठी, + हिंदी, + English, + Hinglish (Hindi in Latin letters), + ગુજરાતી, বাংলা, தமிழ்,
తెలుగు, ਪੰਜਾਬੀ; "Only the translation". The caption lines go to `/api/studio/translate` (`server/studio/translate.ts`: one
text call per batch of up to 120 lines, the `studio_translate` AI task; names, prices, numbers and emoji kept; the answer
can only fill the lines that were asked); each translated line shows for the same seconds as its original, under it,
74% of its size in the calm style, or alone in the line's place. Translations are kept by line text, so another part of the
song or another style asks for nothing again; saved with the Reel. Marathi first: Instagram Edits' bilingual captions
do not include it.

Checked: `tests/server/studio-translate.test.ts` (limits, the prompt, answers bounded to the lines asked, one call) and
`scripts/studio-text/check-translate.cjs` (16 lines in 1 request; the translation drawn under the line, or alone; a 15 s
part afterwards: no new request).

## My music, and export without the song

- **Recent songs** (under "Choose song"): every song used is kept on the phone (IndexedDB, with the saved Reels' files)
  with its finished analysis (beats, drops, the AI beat check), so picking it again is instant; up to 12, the oldest go
  (their file too unless a saved Reel uses it); × removes one. Saved Reels reuse the stored analysis when opened.
- **Without the song** (next to Export): for adding the same song as Instagram's own sound (trending audio that the app
  cannot include). Talking videos and voiceovers keep the voice; otherwise the video has no sound track. The message says
  which song and from where ("start it at 0:17") so the cuts land on its beats.

Checked (`scripts/studio-music/check-mymusic.cjs`): a song analysed and AI-checked in 23.5 s the first time, picked again
from Recent after reopening the page in 0.31 s with the same beats; two songs listed newest first; the export without the
song has a video stream only, and its message names the song and 0:17 (the 15 s part's start); removing one works.

## Style library: learning from reference Reels

- **Save a style**: after "Copy a Reel" reads a Reel, "Save to my styles" under a kind (wedding, travel, festival, dance,
  talking, product, food, fitness, vlog, birthday, other), optionally shared. Only the measured fingerprint is stored
  (MongoDB `studio_styles`, ~1 KB: pace in beats, shot-by-shot beats, hook, transition mix, zoom share, colour look,
  length), never the video. Mine are private (the user's view of the database); shared ones also teach everyone's.
- **Learned style**: "Learned style" → a kind → Mine / With shared → Use. The server learns what the Reels of the kind
  share (`server/studio/styles.ts`): typical numbers (medians), the average transition mix and look, and the rhythm of the
  most typical Reel among them; the phone then copies it like a reference Reel (pace, transitions, zooms, matched look).
- **Corrections**: every transition / effect / speed changed in the edit list is sent (`studio_style_edits`), and the
  creator's own transition changes move the learned mix toward what they pick.
- **Accuracy**: leave-one-out: each Reel of the kind is predicted from the others and compared (pace, transitions, zooms,
  look), next to the app's default style; shown with the style ("predicts a new dance Reel 91% (default 42%)").

Checked: `tests/server/studio-styles.test.ts` (7): synthetic wedding and dance Reels, learned styles 0.85-0.96 against the
default's 0.34-0.45 (3 to 30 Reels), 400/400 new Reels closer to their own kind's style, corrections move the mix,
fingerprints validated (no video, known kinds, bounded sizes), storage: mine private, shared ones teach others, corrections
stay with their creator, nobody deletes another's style. `scripts/studio-style/check-library.cjs` (phone, server stood
in): a real reference Reel saved as a 1,070-byte fingerprint (46% whip, 46% zoom, 8% hard: its truth is half whips, half
zooms); a learned dance style used: median shot 0.50 s = 1 beat, transitions 46% flash / 35% whip / 20% hard (learned
45/35/20); a changed transition sent as a correction.

## ◆ Keyframes: move, zoom, turn, fade a shot or a text

- **Panel** "◆ Keyframes" under the preview. The target is the selected text / sticker, otherwise the shot under the
  playhead. Five sliders: Move ↔, Move ↕ (share of the frame), Zoom (0.1-4×), Rotate (±360°), Opacity.
- **Like the big editors**: moving a slider (or dragging the picture while the panel is open) writes a keyframe at the
  playhead: on a keyframe it changes it, between keyframes it adds one holding the in-between values. One keyframe is a
  fixed setting; two or more animate. The strip shows the target's time, its keyframes (◆) and the playhead (tap to move
  it, a tap near a ◆ lands on it); ◀◆ / ◆▶ jump between keyframes; Delete ◆, Clear all; double-tap a slider resets it.
- **Ease** of each keyframe shapes the move into it: Smooth, Linear, Ease out, Ease in, Overshoot, Fast stop, Hold (jump).
- **Ready-made moves**: slow zoom in / out, pan left → right, pan up, zoom punch, pop in, spin in, slide in, rise in,
  fade in + out, tilt + zoom (filled across the shot's or text's time).
- **Rendering**: on top of the automatic effects, in both the GPU and the 2D renderer and the export (the same code). A
  moved shot turns about its own middle; a shot made smaller, moved or turned shows black around it, not stretched edges.
  Shots with keyframes get a ◆ in the timeline and the edit list. Saved with the Reel (also for talking videos).
- Keyframes stay on their shots when the edit is made again at the same times (the AI's scores or the director
  arriving later, New mix); another mode or length makes new shots (new times), without them.

Checked (`scripts/studio-keyframes/check-keyframes.cjs`, a bright bar on a dark clip measured in rendered frames), the
same on the GPU and the 2D renderer: linear move half way 0.100 / -0.050 (set 0.100 / -0.050), smooth ease at 25% 0.030
(0.029), zoom 1.5× area 2.233 (2.25), zoom 0.5× area 0.244 (0.25), rotate 30.0° (30°), opacity 50% brightness 0.502, hold
0.000. The panel: two keyframes written by the sliders, the in-between values shown half way, ◀◆ / ◆▶, ease, delete;
dragging the picture 10% moved the shot 0.100; a text moved 0.200 and sized 1.500× (set 0.2, 1.5×); saved with the Reel;
the exported 1080p video: bar at 0.700, 0.500 and 20.0° against the preview's 0.699, 0.499 and 20.0°.

## The studio's look: Simple / Editor / Pro, menu, Ivory / Noir

Built to the design "D · Combined" (phone: Simple, Menu, Editor, Pro; computer: Home, Pro editor).

- **Full-screen workspace** with its own top bar. Phone: the menu (☰), the Reel's name and saved state, Export (Editor,
  Pro), the Simple / Editor / Pro switch. Computer: Reel Maison, Home · My projects · Templates · Style library · My
  music, the theme button, the account, the switch and Export.
- **Home**: "What are we making today?", Music Reel / Talking Reel / Copy a Reel, Continue editing (the Reels saved on this
  device), Your style library (the kinds with saved Reels and how well each is learned; tap one to use it, "+ Teach a
  new style from a Reel"), templates, then the steps.
- **Simple**: the preview with "Your Reel is ready", its length, shots and song, New mix; four cards (Style, Text, Look,
  Music) showing what is chosen, each opening its panels (Text: text + captions, Look: look + background, Music: the song,
  its part, the clips, the voiceover); "Want to change every shot? Open the Editor view"; the Save video bar with
  "Without the song". The song and clips steps are out of the way once the Reel is made (the Music card opens them).
- **Editor**: the preview, the time, cover / play / New mix, the shot strip and the song's line, the current shot
  ("Shot 1 · Transition / Effect / Speed" as chips, "Use a different moment"), the dock (Shot, Music, Text, Captions,
  Look, Motion, Background, Voice, Style) at the bottom of a phone.
- **Pro**: the shot inspector beside the preview (transition, effect, speed), a timeline with Video (shots, keyframes ◆),
  Text, Voice and Music tracks (tap to move the playhead), keyframes, all shots; tools Shot, Text, Audio, Look,
  Background. On a computer: the tools in a rail, the preview with previous / play / next, the inspector on the right, the
  timeline across the bottom.
- **Menu**: New Reel, Home, My projects, Templates, Style library, My music; Open my Reels in Simple / Editor / Pro;
  Theme Ivory / Noir / Auto; Settings, Help & tips, Pricing & credits.
- The engine's controls are the same elements (`components/studio/views.ts` shows, hides and forwards to them).
  `/studio?view=pro&tool=style` opens a view and a tool; `?view=all` opens every panel (the checks use it).
- Not in the app yet (drawn in the design): Undo, and Split in Pro.

Checked: screenshots of every design screen (phone Ivory / Noir, computer) against the design; WebKit renders it;
`scripts/studio-ui/check-views.cjs`: Simple's four cards open text + captions, look + background, music + voice;
"Add or change clips" opens step 2; an Editor chip changes the shot's transition (hard → fade-in) and lights up; the
Effect tab shows its 13 choices; the Pro inspector changes the speed; tapping the Pro timeline at 75% moves the playhead
to 0.75; the menu's Noir and Simple apply and are remembered. `check-keyframes`, `check-overlays`, `check-templates` pass.
