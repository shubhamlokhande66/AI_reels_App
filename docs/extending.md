# Extending the system

Nothing below requires touching the rendering engine.

## Add an editing style
Styles are data. In `backend/app/styles/builtin.py` (or your own module imported at startup):

```python
register_style(EditingStyle(
    id="sport", name="Sport", description="…",
    cut_beats_high=1, cut_beats_low=2, min_segment=0.3, max_segment=2.0,
    transitions={"cut": 0.7, "flash": 0.2, "zoom": 0.1}, transition_duration=0.1,
    effects={"punch": 0.6, "zoom_in": 0.4}, motion_preference=1.0,
))
```
It shows up in `/api/styles` automatically; add its label to `frontend/lib/format.ts` (`STYLE_LABELS`).

## Add a transition
`backend/app/video/transitions.py`: `register(TransitionSpec("wipe", "xfade", "wipeleft"))`, then reference `"wipe"`
in a style's `transitions`. Kinds: `cut`, `xfade` (any FFmpeg xfade name), `ramp` (baked into the outgoing shot).

## Add a crop strategy
Subclass `CropStrategy` in `video/cropper.py` (`compute(src_w, src_h, aspect, focus) -> CropRegion`) and
`register_crop_strategy(...)`. `RenderConfig.crop_strategy` selects it. A vision model can feed it through the
`subject` focus source (see below).

## Add an AI provider
Subclass `AIProvider` (`chat`, `health`) in `backend/app/ai/`, and return it from `get_provider()` for your
`AI_PROVIDER` value. `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider` exist as clearly-marked TODO stubs.
Only text crosses this interface.

## Add a vision model (Phase 11 TODO)
Implement `VisionAnalyzer.analyze_frames(frames) -> list[FrameAnnotation]` (`ai/vision.py`) and call
`set_vision_analyzer(...)`. `apply_annotations(clip_analysis, annotations)` already turns subject boxes into crop
focus (`focus_source="subject"`) and importance into window quality. What is still missing: sampling frames to disk
and calling this from the pipeline after `analyze_videos` (a ~20-line hook in `jobs/pipeline.py`).

## Add a trend source
Subclass `TrendSource.list_trends()` returning `TrendPreset`s from a **legitimate** API/data provider and
`set_trend_source(...)`. Do not scrape platforms.

## Add a storage backend (S3 / R2)
Implement `StorageBackend` (`storage/base.py`); FFmpeg/OpenCV need local files, so `local_path()` should download to a
cache and `new_local_path()` + `commit()` should upload. Select it in `storage/__init__.py::get_storage`.

## Add a caption style
`backend/app/captions/ass.py`: add a `CaptionStyle` to `_STYLES` and the name to the `CaptionStyle` literal in
`schemas/project.py` and to `CAPTION_STYLES` in the frontend form.
