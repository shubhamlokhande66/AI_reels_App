# Architecture

## Data flow

```
POST /generate ──► JobManager.submit ──► job doc (queued) + project.status=processing
                        │  asyncio task
                        ▼
                ThreadPoolExecutor ── run_pipeline(PipelineInput) ──► progress(stage, 0..1)
                        │                     │                              │
                        │        (pure, sync, no DB)                         └► job doc (only_active writes)
                        ▼
              _finish: media summaries, renderings doc, project.timeline/output, job completed
```

`jobs/pipeline.py` is deliberately free of MongoDB and HTTP: it takes plain dataclasses and a `StorageBackend`,
which makes it unit-testable and lets it move to a real queue (Celery/RQ/…) without changes.

### Stages (weights of the overall progress bar)

`analyzing_videos` 30 · `analyzing_music` 8 · `detecting_beats` 7 · `selecting_clips` 5 · `creating_timeline` 5 ·
`generating_captions` 8 *(only with captions)* · `writing_copy` 4 *(only with AI assist)* · `rendering` 45.
Analysis results are cached per media file (`analysis/clip_<id>.json`, `audio_<id>.json`), so re-generating a
project skips straight to timeline + render.

## The editing engine (`video/timeline.py`)

Pure functions; same seed ⇒ same edit, different seed ⇒ a new version.

1. **Music window** – pick a beat-aligned start maximising energy (bonus for drops / bar downbeats). A song shorter
   than the request shortens the Reel and warns.
2. **Cut planning** – the beat grid starts at 0; shot length in beats comes from the style (`cut_beats_high/low`)
   depending on local energy; the end of each shot prefers a strong beat; no runt shot at the end.
3. **Selection** – for each slot, score every candidate (clip window × start offset):
   window quality, motion matched to energy (`target_motion`), "use every clip once" bonus, reuse and
   source-overlap penalties, colour-histogram similarity to the previous shot, orientation/opening/closing style
   hooks, optional AI order hint. Windows too short for the slot are skipped; if none fit, slow motion stretches
   the longest one and a warning is added.
4. **Effects & transitions** – weighted by style and energy; never the same transition twice in a row; capped
   share of non-cut boundaries ("don't overuse").

## The render engine

`cutter` → one intermediate MP4 per segment (crop → speed → fps → zoom → optional speed-ramp → grade) ·
`composer` → one `filter_complex` joining them (`concat` for cuts, `xfade` for overlaps), music trimmed to the
window with fades + loudness normalisation, single final H.264/AAC encode (`+faststart`) ·
`renderer` → orchestration, disk-space pre-check, overall deadline, monotonic progress, cleanup in `finally`.

Transition overlap is handled by giving each segment a *tail* equal to the next transition, so the beat-aligned
cut times and the total duration never drift.

## Persistence

MongoDB collections: `projects`, `media`, `jobs`, `renderings` (+ `users`, `styles` reserved). Files live under
`storage/projects/{id}/{input,analysis,temp,output}` behind `StorageBackend`. Datetimes are timezone-aware UTC.
Jobs left running by a crashed server are marked `JOB_INTERRUPTED` on the next start.
