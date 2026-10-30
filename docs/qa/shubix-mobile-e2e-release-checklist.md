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
- [ ] Verify every tool label, help text, disabled state, plan lock, toast and confirmation is translated through the studio text helper.
- [ ] Confirm unavailable tools are clearly identified and never appear to have applied when they have not.

## Export
- [ ] Export simple cut-only projects through the shared Android renderer.
- [ ] Export projects with unsupported transitions/effects and verify compatibility handling is explicit.
- [ ] Check all aspect ratios: 9:16, 4:5, 1:1 and 16:9.
- [ ] Check source audio + music combinations, source trim, speed, rotation, mirror and flip.
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
