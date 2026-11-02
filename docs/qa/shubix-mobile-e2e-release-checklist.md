# Shubix mobile end-to-end QA checklist

This checklist is a release gate for the shared editing/rendering migration. Source review is not a substitute for running the app or testing on physical devices.

## Create flow and persistence
- [ ] Open each entry point: Music Reel, Talking Reel, Photos to Reel, Story, Template and Copy a Reel.
- [ ] Verify required-step button states, back navigation and Android hardware back.
- [ ] Select 1, 5 and 30 mixed media assets; verify order, duplicate names and picker cancellation.
- [ ] Select, replace and remove music; verify song start/length and permission-denied messages.
- [ ] Background/foreground the app during analysis; verify no duplicate jobs or stale progress.
- [ ] Kill/relaunch the app and reopen saved drafts; verify app-private media URIs still resolve.

## Editor UI
- [ ] Check small (360dp), common (393dp), large (432dp) and tablet widths; no horizontal overflow or clipped controls.
- [ ] Check light/dark themes, system font scaling, safe areas, keyboard overlap and Android gesture navigation.
- [ ] Preview video and image clips; play/pause, scrub, previous/next, end-of-clip and audio toggle.
- [ ] Add/replace/reorder/delete/duplicate/split clips; verify undo and autosave.
- [ ] Check trim boundaries, 0.25x–4x speed, mute/volume, fit/fill, rotate, mirror and flip.
- [ ] Add multiple overlapping text overlays; check Devanagari, emoji, long text, timing, colour, size and safe area.
- [ ] Verify ripple delete/insert across clip boundaries, including source-time preservation and clips split at the playhead.
- [ ] Verify slip edits change source in/out points without moving the clip on the timeline.
- [ ] Verify motion-path Bezier handles, endpoint clamping and easing at frame-level timestamps.
- [ ] Verify dialogue ducking attack/hold/release with overlapping speech intervals and music fades.
- [ ] Verify every tool label, help text, disabled state, plan lock, toast and confirmation is translated through the studio text helper.
- [ ] Confirm unavailable tools are clearly identified and never appear to have applied when they have not.

## Export
- [ ] Export simple cut-only projects through the shared Android renderer.
- [ ] Export projects with unsupported transitions/effects and verify compatibility handling is explicit.
- [ ] Check all aspect ratios: 9:16, 4:5, 1:1 and 16:9.
- [ ] Check source audio + music combinations, source trim, speed, rotation, mirror and flip.
- [ ] Export with per-clip source volume at 0%, 25%, 50%, 75% and 100%; confirm mute and gain are audible and match preview.
- [ ] Export music at multiple gain levels with fade-in and fade-out; inspect the first/last seconds for clicks or abrupt cuts.
- [ ] Enable dialogue ducking with speech clips; confirm music lowers during source dialogue and recovers smoothly between clips.
- [ ] Verify shared Android RenderJob rejects unsupported timeline starts and >100% native audio gain with an actionable message.
- [ ] Check multiple simultaneous text overlays and Devanagari in the actual MP4, not only preview.
- [ ] Cancel during preparation, decode and encode; verify the native job stops and a new export can start.
- [ ] Simulate disk-full, missing source, revoked URI, codec failure and permission denial.
- [ ] Save to Photos, deny Photos permission, share, reopen the exported file and verify file size/duration.
- [ ] Verify failed export keeps the draft and the retry button works.

## Device/performance matrix
- [ ] Low-tier Android (3–4 GB RAM, older SoC).
- [ ] Mid-tier Android (6–8 GB RAM).
- [ ] Flagship Android (12 GB+ RAM).
- [ ] Test 15s, 30s and 60s reels; 1080p and mixed 4K source media.
- [ ] Record cold start, time to first preview, preview dropped frames, peak PSS/RAM, export duration, thermal throttling and crash rate.
- [ ] Repeat export 3 times; check native decoder/encoder and bitmap resources are released.
- [ ] Test Android background/foreground, screen lock and low-storage conditions.

## Web / shared contract parity
- [ ] Feed identical versioned RenderJob fixtures to web and Android adapters.
- [ ] Compare timing, aspect/crop, rotation, mirror/flip, filters, text position/timing and audio sync.
- [ ] Document known renderer differences and unsupported capabilities; no silent feature loss.
- [ ] Run Shared Core and mobile typecheck, web tests/build, Android Gradle build and instrumentation tests.

## Current status
- Shared RenderJob contract, Android adapter, project converter, guarded export routing and export UI recovery have been added to the working branch.
- The established web/legacy export paths remain in place for compatibility.
- No typecheck, Gradle build, automated UI run, emulator run or physical-device benchmark has been verified in this environment.
- Do not mark this checklist complete or claim lag-free performance until the checks above have actually run and their results are recorded.

- [ ] Android native transitions: Fade in, slide left/right/up/down, zoom in/out, spin, whip-pan, blur and flash must animate from the incoming pose to the final pose over the configured duration; verify no black flash or frozen first frame.
- [ ] Android shared-render export: Blur, brightness, contrast, saturation and hue effects must be visible in the exported MP4 and match the preview intensity.
- [ ] Android shared-render export: Blur pulse must visibly animate across the shot; confirm GPU processing remains stable on a mid-tier device.
- [ ] Android native export: Try unsupported transitions (Dissolve/Crossfade, Glitch, Wipe, Push) and masks/layers; confirm export returns an explicit unsupported-feature error rather than silently omitting the edit.
- [ ] Verify every Android-supported color preset, including Warm, Cool, Teal & Orange, Sepia, Matte, High Contrast, Faded, Vintage, Pastel, Cyberpunk, Dreamy, Black & White, Soft Focus, Color Pop, Muted, Sunset and Arctic.

- [ ] Android shared-render motion effects: Zoom punch, soft zoom, zoom burst, slow drift, pan, shake, bounce, tilt, photo snap, hook zoom, punch-in and heartbeat must animate; compare timing and scale against preview and check for frame jitter.

- [ ] Android native Blur and Flash transitions: verify the blur clears smoothly and flash decays without clipping or a white-frame stutter, including when a clip has speed-ramp slices.
- [ ] Android native Fade/Zoom/Slide/Spin/Whip-pan transitions: verify they run once at the start of each clip, not once per speed-ramp segment.
- [ ] Verify Dissolve/Crossfade, Push and Wipe are rejected with an explicit unsupported-feature message until a true multi-clip transition compositor is implemented.

- [ ] Studio layer masks: verify Ellipse, Rectangle, Polygon, Linear, Radial and Luma masks, including feather, invert and luma threshold. Check the polygon default six-point path and resizing/rotation.
- [ ] Studio layer compositor: verify Normal, Screen, Multiply, Overlay, Soft light, Lighten, Darken, Colour dodge and Difference blends, chroma key, crop, opacity, fade-in/out and overlapping video/photo layers.
- [ ] Verify all layer masks, blend modes and overlays appear in the final MP4 on Android when exported through the originating Studio session; the native editor preview is not a pixel-identical compositor.

- [ ] Android native export: overlapping active text overlays must composite together in the same frame; verify none of the active titles/captions disappear behind the first matching overlay.

- [ ] Native transform keyframes: verify normalized X/Y movement uses the full output-frame width/height, zoom and rotation stay centered, and speed-ramp slices do not restart the animation.

- [ ] Android native captions: verify long text wraps into multiple lines within the output frame, multiple simultaneous captions remain visible, and no text is clipped at the frame edges.

## Music Reel acceptance coverage (ChatGPTV1)

- [ ] Pick, replace and remove a song; cancel the picker; test unreadable, silent, unsupported and missing audio.
- [ ] Rapidly replace songs while analysis is running; only the latest song's analysis may update the flow.
- [ ] Verify Music Reel cannot proceed as if beat-sync succeeded when the native Shubix engine is unavailable or song analysis failed.
- [ ] Select 1, 5 and 30 videos; reject a 31st clip and accept videos and photos; reject unsupported media types in the Music Reel picker.
- [ ] For a source video >=512 MiB or a combined selection >=1 GiB, show the large-selection confirmation before copying; cancelling must leave the selection unchanged.
- [ ] Verify large-selection confirmation never modifies or compresses the original source files.
- [ ] Verify Music Reel-specific picker guards do not change Talking Reel, Photos to Reel or Copy a Reel selection behaviour.
- [ ] Verify the full Music Reel path: song analysis, beat/drop alignment, AI shot plan, editor changes, preview and MP4 export.
- [ ] Run `music-reel-media.test.ts`, mobile typecheck, web tests/build and Android Gradle build.
- [ ] Repeat on a low-memory Android device with large 4K/HEVC sources; record peak memory, analysis time, preview frame drops and export duration.

Source changes in this batch add deterministic picker guards, large-file confirmation, stale-song-analysis protection and a hard stop against silently falling back to an unsynchronised Music Reel. These are code-level changes only; the device and build checks above remain release gates until executed.


## Autonomous Music Reel release gates (six-phase roadmap)

### 1. Music intelligence
- [ ] Verify BPM, beat/downbeat, drop and quiet-range analysis against reference tracks with known timing.
- [ ] Verify song replacement cancels stale analysis and only the latest selection drives the plan.
- [ ] Verify cuts stay within the selected song segment and do not claim beat-sync when no valid beat grid exists.

### 2. Autonomous AI Director
- [ ] Verify the opening hook, story progression, visual diversity and intentional ending.
- [ ] Verify scene/subject tags, speech protection, must-include and avoid instructions affect the final selected shots.
- [ ] Verify a plan is not marked ready when footage cannot fill the requested duration or required subjects are omitted.

### 3. Natural-language editor
- [ ] Verify Marathi, Roman Marathi, Hindi and English instructions map to deterministic edit intent.
- [ ] Verify all-clips instructions apply to every eligible clip, while single-clip instructions remain scoped.
- [ ] Verify unsupported requests are reported instead of silently acknowledged as completed.

### 4. Self-correcting quality
- [ ] Verify missing/black/blurred/duplicate frame and audio clipping probes produce actionable repair recommendations.
- [ ] Verify a failed quality report cannot be represented as a passed export.
- [ ] Verify any automatic repair is followed by a fresh render and a fresh quality inspection.

### 5. Advanced editing
- [ ] Verify each advertised effect, transition, mask, keyframe and speed-ramp is supported by the active renderer.
- [ ] Verify unsupported native Android operations fail with an actionable message and are never silently dropped.
- [ ] Verify preview and exported output match for every supported Music Reel operation.

### 6. Autonomous workflow
- [ ] Verify cancellation, retry, progress, draft recovery and export failure paths.
- [ ] Verify device capability and memory budgets constrain analysis, decoding and rendering.
- [ ] Verify the final MP4 is playable, has expected duration/dimensions/audio and passes the quality gate.

These are release gates, not claims of completed device verification. A planner status of `ready` means the selected plan meets the deterministic coverage checks; it does not replace Android device testing or perceptual review.


## Android six-phase implementation coverage (ChatGPTV1)

### 1. Music intelligence
- Android Studio song analysis now validates duration, BPM, beat/drop/break counts before the result is accepted.
- Replacing or removing a soundtrack invalidates an older in-flight song request; the old song's beat grid cannot overwrite the newer choice.
- When the originating Studio session is still held, soundtrack and ordinary text-overlay edits sync back into that session so its masks/layers/effects are not silently lost at export.
- [ ] Verify 5 rapid song replacements, picker cancellation, unreadable audio and songs with no reliable beat grid on a physical Android device.

### 2. Autonomous AI Director
- The Android bridge now rejects an empty/incomplete Director result instead of marking the draft as held and ready.
- [ ] Verify low-footage, unsupported media, scene diversity, opening hook, ending and requested-subject coverage with real clips.

### 3. Natural-language editor
- The Android editor applies all-clips transition/effect commands locally and synchronizes the updated clip list to the held Studio session.
- [ ] Verify Roman Marathi, Devanagari Marathi, Hindi and English instructions, mixed requests and single-shot scope on-device.

### 4. Export quality gate
- Native Android export now reopens the completed MP4 metadata and checks that video dimensions and duration are readable and that duration is within 3% (or 1.5 seconds) of the edit.
- Invalid or truncated outputs are deleted and reported as export failures; the draft remains available for retry.
- [ ] Verify actual MediaMetadataRetriever output and the duration tolerance across 15s/30s/60s exports and multiple Android codecs.

### 5. Advanced editing
- The Android Media3 engine already supports bounded speed-ramp slices, per-shot transform/opacity keyframes, native filters/effects, supported transitions, captions and music fades/ducking.
- Unsupported transitions, reverse playback and unsupported native effects remain explicit errors rather than silently disappearing.
- Native-only Android drafts now show only transitions/effects that the installed Media3 renderer can export; Studio-originated drafts retain the full Studio library while their session is available.
- [ ] Compare preview/export parity for every advertised native feature, including keyframe easing and speed-ramp boundaries.

### 6. Autonomous workflow and recovery
- Android Studio bridge calls now have readiness and operation timeouts, a single-flight setup, stale-request rejection, malformed-message guards and restart cleanup.
- Native export validates the completed file before returning it; the export screen also rejects empty/invalid renderer results and retains retry behavior.
- [ ] Verify process death, network failure, timeout, cancellation, disk full, retry, app background/foreground and recovery of the saved draft.

These are source-level safeguards and integration changes. They do not establish that the six phases have passed Android QA. Mobile TypeScript checks, Kotlin/Gradle build, emulator tests and physical-device tests remain required before release.
