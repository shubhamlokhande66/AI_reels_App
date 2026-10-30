# Shubix cross-platform editing architecture

## Decision

Keep one monorepo and one platform-neutral editing core. Keep the user interfaces and media pipelines platform-specific.

- Shared Core owns deterministic analysis, shot ranking, timeline/edit decisions, serializable edit plans, validation and capability-independent rules.
- Web owns browser media access, WebCodecs/Mediabunny/Canvas preview and browser export.
- Android owns Media3/Transformer, Android decoding/encoding, file access and native preview surfaces.
- iOS should later use an AVFoundation adapter behind the same renderer contract.
- Backend owns authenticated AI/provider calls, account/credit enforcement, durable jobs and server-only processing. It must not become a mandatory hop for local editing.

## Dependency direction

`web-app -> @shubix/core`
`mobile-app -> @shubix/core`
`api -> @shubix/core`

Shared Core must not import React, React Native, DOM globals, browser codecs, Android/iOS SDKs, filesystem APIs or server-only modules. Platform adapters may depend on Shared Core; Shared Core must never depend on an adapter.

## Target package boundaries

### Shared Core

- `engine/audio`: platform-independent audio feature and beat interpretation logic.
- `engine/video`: frame-data analysis, clip scoring, shot and moment selection. Decoding and face-detection providers are injected.
- `engine/brain`: deterministic director orchestration and AI response normalization.
- `engine/timeline`: timeline model and timing calculations.
- `engine/edit-plan`: versioned edit-plan schema, builders and migrations.
- `engine/transitions` and `engine/effects`: parameterized edit decisions, not rendering implementations.
- `engine/rendering`: renderer contracts and renderer-independent job validation.
- `engine/validation`: quality, duration, locks, capability and renderability checks.
- `types`: stable cross-platform contracts.

### Web app

- UI, editor interactions and browser lifecycle remain in the web app.
- Web renderer adapter implements the shared renderer contract using browser APIs.
- Keep the existing Fast Studio bridge operational during migration.
- Browser-only code remains outside Shared Core.

### Mobile app

- React Native owns app screens and editor UI.
- Native module exposes a typed Android renderer adapter.
- Kotlin/Media3 owns decode, preview composition and export where supported.
- Avoid sending large frame buffers or full media files through the React Native JS bridge. Prefer file URIs, native handles and bounded progress events.
- Keep the current hidden WebView path as a compatibility fallback until native feature parity and performance are measured. Do not remove it based only on code structure.

### Backend

- Nest/Node API owns auth, entitlements, credits, rate limits, provider calls, persistence and optional remote jobs.
- Reuse pure Shared Core rules only where runtime-compatible.
- Do not send original media to the backend unless a feature explicitly requires it and the user is informed.

## Render contract

The shared render specification is versioned and serializable. It describes sources, timeline items, timing, transforms, effects, audio and output settings. Each renderer:
1. Reports its capabilities and conservative resource limits.
2. Validates that the requested edit is supported.
3. Returns a clear unsupported-feature error or an explicitly approved fallback; never silently drops an effect.
4. Emits normalized progress, completion, cancellation and failure events.
5. Owns its own decoder/encoder lifecycle and releases resources on success, failure and cancellation.

A common edit plan does not imply pixel-identical output across codecs/platforms. Maintain a feature compatibility matrix and golden visual/audio tests for supported features.

## Android performance principles

- Keep scroll, gestures and editor UI responsive; do not run full-resolution frame analysis on the UI thread.
- Use bounded decode concurrency and bounded frame pools based on measured device capability, not RAM hints alone.
- Analyze downscaled frames; decode full resolution only for preview/export.
- Cache audio/video analysis using a stable media fingerprint plus analysis-version key.
- Cancel obsolete analysis/render jobs when the user changes source or leaves the editor.
- Avoid unbounded JS/native bridge messages. Send compact commands and throttled progress.
- Prefer native Media3 preview/export for supported workloads; retain a tested fallback for unsupported effects.
- Measure cold start, time-to-first-preview, preview frame pacing, peak memory, thermal behavior, export time and failure rate on low-, mid- and high-tier devices.

## Migration plan (incremental; preserve behaviour)

1. Inventory imports and classify existing engine code as pure logic, browser runtime, UI orchestration or rendering.
2. Add tests around current EditPlan/timeline/audio/video behaviour before moving implementations.
3. Extract one pure module at a time into Shared Core; keep existing public APIs as compatibility facades.
4. Convert web engine to consume Shared Core without changing user-visible behaviour.
5. Implement Android adapter for a small, well-defined feature subset; explicitly report unsupported features.
6. Run web-vs-Android parity tests on the same versioned edit-plan fixtures.
7. Expand Android feature coverage only when visual quality, memory and performance gates pass.
8. Add iOS adapter later using the same contracts.
9. Remove the hidden WebView bridge only after all required flows have native equivalents and production telemetry confirms stability.

## Quality gates

- Typecheck and unit tests for Shared Core.
- Web app typecheck, lint, tests and production build.
- Android native build and instrumentation tests.
- Edit-plan contract tests and renderer capability tests.
- Golden tests for cuts, trims, crop/fit, speed, transitions, overlays, effects and audio sync.
- Device matrix: low-memory, mainstream and flagship Android devices.
- No release claim of “lag-free” without measured results; publish target budgets and observed percentiles.

## Current implementation status

This document defines the target architecture, not a claim that migration is complete. The existing mobile flow still uses a hidden web engine for much of Fast Studio and has a native Android export module. The first code addition is the platform-neutral renderer contract under `Shared/core/src/engine/rendering`. Existing modules and bridges must be mapped and migrated incrementally.
