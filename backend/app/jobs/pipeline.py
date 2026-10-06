"""The synchronous reel pipeline. Runs inside a worker thread; knows nothing about MongoDB.

Stages (name, label, weight of the overall progress bar):
"""

from __future__ import annotations

import json
import logging
import shutil
from dataclasses import replace
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from app.audio.analyzer import analyze_audio
from app.captions.ass import ass_filter, write_ass
from app.models.analysis import Section
from app.captions.cues import captions_to_cues, cues_to_captions, group_words
from app.captions.transcriber import transcribe_window
from app.ai.clip_selector import suggest_clip_order, suggest_style
from app.ai.copywriter import generate_post_copy
from app.ai.director import plan_story, story_order_hint
from app.ai.orchestrator import plan_agents
from app.ai.provider import get_provider
from app.ai.understanding import SEMANTIC_VERSION, ClipSemantic, understand_clip
from app.audio.analyzer import ANALYSIS_VERSION
from app.core.config import get_settings
from app.core.errors import AppError
from app.models.analysis import AudioAnalysis, ClipAnalysis
from app.models.timeline import Timeline
from app.schemas.project import ProjectSettings
from app.storage import StorageBackend, project_key
from app.styles import AUTO_STYLE, get_style, list_styles
from app.styles.resolve import apply_pace, resolve_style
from app.video.analyzer import VIDEO_ANALYSIS_VERSION, analyze_clip
from app.video.cutter import RenderConfig, SourceClip
from app.video.hardware import pick_encoder
from app.video.presets import config_for, get_preset
from app.video.renderer import RenderResult, render_timeline
from app.director.music_map import build_music_map, song_hits
from app.director.plan import build_reel_plan
from app.director.creative_review import auto_revise, review_edit
from app.director.intelligence import find_hero, rank_hooks
from app.director.review import check_render, review_timeline
from app.director.story import detect_category, order_for_food
from app.video.steps import build_steps_timeline, order_clips
from app.video.timeline import ClipInput, build_timeline

log = logging.getLogger(__name__)

STAGES: list[tuple[str, str, float]] = [
    ("analyzing_videos", "Analyzing videos", 0.30),
    ("analyzing_music", "Analyzing music", 0.08),
    ("detecting_beats", "Detecting beats", 0.07),
    ("understanding_clips", "Understanding clips", 0.25),
    ("understanding_images", "Understanding the photos", 0.10),
    ("planning_shots", "Planning the shots", 0.05),
    ("selecting_clips", "Selecting clips", 0.05),
    ("creating_timeline", "Creating timeline", 0.05),
    ("generating_captions", "Generating captions", 0.08),
    ("writing_copy", "Writing title & description", 0.04),
    ("reviewing", "Reviewing & improving the edit", 0.02),
    ("rendering", "Rendering video", 0.45),
]
ANALYZE_STAGES = ("analyzing_videos", "analyzing_music", "detecting_beats")

# progress(stage_name, fraction_of_stage 0..1)
StageProgress = Callable[[str, float], None]


@dataclass
class MediaRef:
    id: str
    name: str
    key: str
    width: int = 0
    height: int = 0


# Long Reels get proportionally more time: a 5 minute Reel is not expected to render in 15 minutes on a CPU.
RENDER_SECONDS_PER_SECOND = 12


@dataclass
class PipelineInput:
    project_id: str
    job_type: str  # "analyze" | "generate"
    videos: list[MediaRef]
    audio: MediaRef | None
    settings: ProjectSettings
    rendering_id: str = ""
    seed: int = 0
    project_name: str = ""
    kind: str = "final"  # final | preview (small and fast, for editing feedback)
    timeline: Timeline | None = None  # set for job_type == "render" (and the base edit for "variations")
    strategies: list[str] = field(default_factory=list)
    variant_ids: list[str] = field(default_factory=list)  # one pre-allocated rendering id per strategy
    images: list[MediaRef] = field(default_factory=list)  # product Reels: the photos, in order
    revision: list[dict] = field(default_factory=list)  # global edit actions to apply to the freshly built timeline
    references: list[dict] = field(default_factory=list)  # learned trends the AI may edit like (see trends/reference.py)
    profile: dict | None = None  # the personal director profile (services/feedback.py), applied to settings left on auto


@dataclass
class VariantResult:
    strategy_id: str
    label: str
    rendering_id: str
    timeline: Timeline
    render: RenderResult
    output_key: str


@dataclass
class PipelineResult:
    clips: dict[str, ClipAnalysis] = field(default_factory=dict)
    audio: AudioAnalysis | None = None
    timeline: Timeline | None = None
    render: RenderResult | None = None
    output_key: str | None = None
    warnings: list[str] = field(default_factory=list)
    post_copy: dict | None = None
    semantics: dict[str, ClipSemantic] = field(default_factory=dict)
    variants: list[VariantResult] = field(default_factory=list)
    product_plan: dict | None = None
    reel_plan: dict | None = None  # the director's plan for an edited Reel (video clips)


PRODUCT_STAGES = ("analyzing_music", "detecting_beats", "understanding_images", "planning_shots", "rendering")


def _active_stages(job_type: str, captions: bool, ai: bool = False) -> list[tuple[str, str, float]]:
    if job_type == "product":  # a Reel directed from product photos
        return [s for s in STAGES if s[0] in PRODUCT_STAGES]
    if job_type == "render":  # re-render a stored (possibly hand-edited) timeline
        return [s for s in STAGES if s[0] == "rendering"]
    if job_type == "variations":  # analyse once, then render several strategies
        return [s for s in STAGES if s[0] in ANALYZE_STAGES or s[0] == "rendering" or (ai and s[0] == "understanding_clips")]
    if job_type != "generate":
        return [s for s in STAGES if s[0] in ANALYZE_STAGES or (ai and s[0] == "understanding_clips")]
    optional = {"generating_captions": captions, "writing_copy": ai, "understanding_clips": ai}
    return [s for s in STAGES if optional.get(s[0], True)]


def stage_names(job_type: str, captions: bool = False, ai: bool = False) -> list[str]:
    return [s[0] for s in _active_stages(job_type, captions, ai)]


def overall_progress(job_type: str, stage: str, fraction: float, captions: bool = False, ai: bool = False) -> int:
    active = _active_stages(job_type, captions, ai)
    total = sum(w for *_, w in active)
    done = 0.0
    for name, _, w in active:
        if name == stage:
            done += w * min(max(fraction, 0.0), 1.0)
            break
        done += w
    return min(int(round(100 * done / total)), 100)


def _load_json(storage: StorageBackend, key: str):
    try:
        return json.loads(storage.read_bytes(key)) if storage.exists(key) else None
    except (ValueError, OSError):
        return None


def _clip_key(pid: str, mid: str) -> str:
    return project_key(pid, "analysis", f"clip_{mid}.json")


def _audio_key(pid: str, mid: str) -> str:
    return project_key(pid, "analysis", f"audio_{mid}.json")


def analyze_videos(inp: PipelineInput, storage: StorageBackend, progress: StageProgress) -> dict[str, ClipAnalysis]:
    """Analyse each clip once; results are cached next to the project so re-runs are instant."""
    out: dict[str, ClipAnalysis] = {}
    n = len(inp.videos)
    for i, v in enumerate(inp.videos):
        cached = _load_json(storage, _clip_key(inp.project_id, v.id))
        if cached:
            try:
                a = ClipAnalysis.model_validate(cached)
                if a.analysis_version >= VIDEO_ANALYSIS_VERSION:
                    out[v.id] = a
                    progress("analyzing_videos", (i + 1) / n)
                    continue
                log.info("clip analysis for %s predates motion direction; recomputing", v.id)
            except ValueError:
                log.info("stale clip analysis for %s; recomputing", v.id)
        a = analyze_clip(
            storage.local_path(v.key), v.id, progress=lambda f, i=i: progress("analyzing_videos", (i + f) / n)
        )
        storage.write_bytes(_clip_key(inp.project_id, v.id), json.dumps(a.to_doc()).encode())
        out[v.id] = a
        progress("analyzing_videos", (i + 1) / n)
    return out


def analyze_music(inp: PipelineInput, storage: StorageBackend, progress: StageProgress) -> AudioAnalysis:
    assert inp.audio is not None
    cached = _load_json(storage, _audio_key(inp.project_id, inp.audio.id))
    if cached:
        try:
            a = AudioAnalysis.model_validate(cached)
            if a.analysis_version < ANALYSIS_VERSION:
                raise ValueError("an older analysis; redo it")
            progress("analyzing_music", 1.0)
            progress("detecting_beats", 1.0)
            return a
        except ValueError:
            pass
    a = analyze_audio(storage.local_path(inp.audio.key), progress)
    storage.write_bytes(_audio_key(inp.project_id, inp.audio.id), json.dumps(a.to_doc()).encode())
    return a


def _semantic_key(pid: str, mid: str) -> str:
    return project_key(pid, "analysis", f"semantic_{mid}.json")


def understand_clips(
    inp: PipelineInput, clips: dict[str, ClipAnalysis], storage: StorageBackend, progress: StageProgress,
    warnings: list[str],
) -> dict[str, ClipSemantic]:
    """What is in each clip (vision model). Cached per clip; one failure never stops the others."""
    out: dict[str, ClipSemantic] = {}
    n = max(len(inp.videos), 1)
    provider = None
    failed: list[str] = []
    for i, v in enumerate(inp.videos):
        progress("understanding_clips", i / n)
        cached = _load_json(storage, _semantic_key(inp.project_id, v.id))
        if cached:
            try:
                sem = ClipSemantic.model_validate(cached)
                if sem.version >= SEMANTIC_VERSION:  # answers from before category/stage existed are asked again
                    out[v.id] = sem
                    continue
            except ValueError:
                pass
        try:
            provider = provider or get_provider("clip_understanding")
            a = clips[v.id]
            sem = understand_clip(provider, v.id, v.name, storage.local_path(v.key), a.metadata.duration,
                                  a.content_rect, provider.vision_model or provider.model, analysis=a)  # fmt: skip
            storage.write_bytes(_semantic_key(inp.project_id, v.id), json.dumps(sem.to_doc()).encode())
            out[v.id] = sem
        except AppError as exc:
            log.warning("understanding skipped for %s: %s", v.name, exc.message)
            failed.append(exc.message)
            repeats = exc.code in ("OLLAMA_UNAVAILABLE", "AI_MODEL_NOT_SET", "AI_VISION_UNSUPPORTED", "OLLAMA_MODEL_MISSING", "AI_BUDGET_EXCEEDED")
            repeats = repeats or getattr(exc, "kind", None) in ("unavailable", "not_configured", "auth", "quota", "model_missing", "unsupported", "budget")
            if repeats:
                break  # the same error would repeat for every clip
    if failed:
        warnings.append(f"Some clips could not be analysed by the vision model: {failed[0]}")
    progress("understanding_clips", 1.0)
    return out


def drop_duplicate_videos(inp: PipelineInput, storage: StorageBackend, warnings: list[str]) -> PipelineInput:
    """The same video uploaded twice (a WhatsApp "(1)" copy, a trimmed re-export) is used only once: the copies are left
    out before any shot is chosen, so no moment can appear twice through a second file. Cached per set of clips."""
    import hashlib

    from app.video.duplicates import find_duplicates, thumbnails

    if len(inp.videos) < 2:
        return inp
    key = project_key(inp.project_id, "analysis", "duplicates_v2_" + hashlib.sha1(",".join(sorted(v.id for v in inp.videos)).encode()).hexdigest()[:16] + ".json")
    found = _load_json(storage, key)
    if not isinstance(found, list):
        try:
            clips = [(v.id, thumbnails(storage.local_path(v.key), 3600.0)) for v in inp.videos]
            found = [{"clipId": d.clip_id, "sameAs": d.same_as, "offset": d.offset} for d in find_duplicates(clips)]
            storage.write_bytes(key, json.dumps(found).encode())
        except Exception as exc:  # noqa: BLE001 - a failed check must never stop a Reel
            log.warning("duplicate check skipped: %s", exc)
            return inp
    if not found:
        return inp
    names = {v.id: v.name for v in inp.videos}
    gone = {d["clipId"] for d in found}
    for d in found:
        if d["clipId"] in names and d["sameAs"] in names:
            warnings.append(f"'{names[d['clipId']]}' is the same video as '{names[d['sameAs']]}', so it was used only once.")
    return replace(inp, videos=[v for v in inp.videos if v.id not in gone])


def skipped_warnings(inp: PipelineInput, clips: dict[str, ClipAnalysis]) -> list[str]:
    names = {v.id: v.name for v in inp.videos}
    out = []
    for cid, a in clips.items():
        if not a.usable:
            reasons = [f for f in a.flags if f in ("too_dark", "too_blurry", "too_short", "low_resolution")] or ["low quality"]
            out.append(f"Skipped '{names[cid]}' ({', '.join(r.replace('_', ' ') for r in reasons)}).")
    return out


def run_pipeline(inp: PipelineInput, storage: StorageBackend, progress: StageProgress) -> PipelineResult:
    s = get_settings()
    res = PipelineResult()
    res.clips = analyze_videos(inp, storage, progress)
    res.warnings = skipped_warnings(inp, res.clips)
    inp = drop_duplicate_videos(inp, storage, res.warnings)
    if inp.audio is None and inp.job_type != "generate":
        return res  # analysis-only requests without music still analyse the clips
    res.audio = analyze_music(inp, storage, progress) if inp.audio is not None else neutral_audio(inp.settings.duration)
    if inp.settings.ai:
        res.semantics = understand_clips(inp, res.clips, storage, progress, res.warnings)
    if inp.job_type == "analyze":
        return res

    inputs = [ClipInput(v.id, v.name, res.clips[v.id], res.semantics.get(v.id)) for v in inp.videos]
    notes: list[str] = []
    ai_tasks: list[str] = ["clip_understanding"] if res.semantics else []
    # The AI director plans the whole edit in one call (story + shots + text + post copy); it replaces the separate
    # style / order / story / copy calls. Step-by-step Reels keep their deterministic order.
    use_director = inp.settings.ai and inp.settings.ai_director and inp.settings.sequence != "steps"
    progress("selecting_clips", 0.0)
    style_id, order_hint = choose_style_and_order(inp, inputs, res.audio, notes, res.warnings, use_ai=not use_director, ai_tasks=ai_tasks)
    style = resolve_style(inp.settings, style_id)
    chosen = next((r for r in inp.references if r.get("chosen")), None)
    if chosen and inp.settings.pace == "auto" and chosen.get("pace") in ("calm", "balanced", "fast"):
        style = apply_pace(style, chosen["pace"])  # cut at the learned trend's pace (rules and the AI's suggested rhythm)
    elif inp.profile:
        from app.services.feedback import apply_profile

        style, profile_notes = apply_profile(style, inp.settings.pace, inp.profile)
        notes += profile_notes
    progress("selecting_clips", 1.0)

    progress("creating_timeline", 0.0)
    director_errors: list[AppError] = []
    directed = direct_reel(inp, inputs, res.audio, style, storage, res.warnings, ai_tasks, director_errors) if use_director else None
    if directed is not None:
        timeline = directed.timeline
        notes += directed.timeline.notes
        timeline.notes = []
        res.post_copy = directed.post_copy
    elif inp.settings.sequence == "steps":
        labels = inp.settings.step_labels and not inp.settings.captions  # song captions use the same text track
        timeline = build_steps_timeline(res.audio, inputs, inp.settings.duration, style, seed=inp.seed, audio_start=inp.settings.audio_start,
                                        teaser=inp.settings.teaser, step_labels=labels, language=inp.settings.language,
                                        order_mode=inp.settings.order_mode)
        if inp.settings.step_labels and inp.settings.captions:
            timeline.notes.append("Step numbers were not added because song captions are on (they share the same text track).")
    else:
        timeline = build_timeline(res.audio, inputs, inp.settings.duration, style, seed=inp.seed, order_hint=order_hint,
                                  brief=inp.settings.brief, audio_start=inp.settings.audio_start)
    timeline.warnings = res.warnings + timeline.warnings
    timeline.notes = timeline.notes + notes
    res.timeline = timeline
    progress("creating_timeline", 1.0)

    provider_down = any(getattr(e, "fallback_ok", False) or getattr(e, "kind", "") == "budget" for e in director_errors)
    if inp.settings.ai and res.post_copy is None and provider_down:  # do not wait for a second call that would fail the same way
        timeline.warnings.append("Title/description were skipped: the AI provider is unavailable.")
        progress("writing_copy", 1.0)
    elif inp.settings.ai and res.post_copy is None:
        res.post_copy = write_copy(inp, timeline, res.audio, progress)
        if res.post_copy:
            ai_tasks.append("copy")
    elif directed is not None:
        progress("writing_copy", 1.0)  # the director already wrote it
    if inp.settings.captions and inp.audio is not None:
        build_captions(inp, timeline, storage.local_path(inp.audio.key), progress)
    if inp.revision:
        timeline = apply_revision(inp, timeline, res)
        res.timeline = timeline

    if inp.settings.ai and ai_tasks:
        timeline.ai = ai_info(ai_tasks, directed is not None)
    steps = inp.settings.sequence == "steps"
    order = ([c.clip_id for c in inputs] if inp.settings.order_mode == "manual"
             else [c.clip_id for c in order_for_food(order_clips(list(inputs), [])).clips]) if steps else None
    teaser_first = steps and len(timeline.segments) > 1 and timeline.segments[0].clip_id in {s.clip_id for s in timeline.segments[1:]}
    mm = build_music_map(res.audio, timeline.audio_start, timeline.duration)
    if inp.audio is not None:  # the song's strong hits: beat-reactive effects pulse on them between cuts
        timeline.music_hits = song_hits(res.audio)
    pace = directed_pace(inp, directed)
    checks = review_timeline(timeline, inputs, mm, steps_order=order, teaser_first=teaser_first, pace=pace)
    max_tr = _transition_budget(timeline.style)
    if inp.settings.auto_review and not inp.revision:  # the Quality Reviewer improves the edit before anything is rendered
        progress("reviewing", 0.0)
        timeline, creative = auto_revise(
            timeline, inputs, mm, brief=inp.settings.brief, max_transition_ratio=max_tr, pace=pace, steps=steps or teaser_first,
            repair=lambda t: review_timeline(t, inputs, mm, steps_order=order, teaser_first=teaser_first, pace=pace),
        )  # fmt: skip
        res.timeline = timeline
        progress("reviewing", 1.0)
    else:
        creative = None
        progress("reviewing", 1.0)
    if inp.settings.sound_effects and inp.settings.audio_mode != "none":
        from app.director.sfx import plan_sfx

        timeline.sfx = plan_sfx(timeline, mm)
        if timeline.sfx:
            kinds = sorted({e.type for e in timeline.sfx})
            timeline.notes.append(f"Sound effects: {len(timeline.sfx)} ({', '.join(kinds)}), placed on transitions, the drop and text.")
    category = detect_category([c.semantic for c in inputs], timeline.style, steps)
    story_notes = [n for n in timeline.notes if steps and ("what they show" in n or "file names" in n or "clip list" in n or "finished dish" in n)]
    res.render, res.output_key = render_edl(inp, timeline, res.clips, storage, progress)
    rendered = check_render(storage.local_path(res.output_key), res.render.duration, inp.audio is not None and inp.settings.audio_mode != "none",
                            expect_preview=inp.kind == "preview")
    checks += rendered
    res.reel_plan = build_reel_plan(timeline, inputs, mm, category, checks, steps=steps, teaser=teaser_first, story_notes=story_notes)
    final = review_edit(timeline, inputs, mm, brief=inp.settings.brief, max_transition_ratio=max_tr, pace=pace, steps=steps or teaser_first,
                        render_checks=rendered)  # fmt: skip
    final.iterations = creative.iterations if creative else []
    res.reel_plan["review"] = final.to_doc()
    res.reel_plan["hookCandidates"] = [h.to_doc() for h in rank_hooks(inputs, inp.settings.brief)]
    hero = find_hero(inputs)
    res.reel_plan["heroMoment"] = hero.to_doc() if hero else None
    if directed is not None and getattr(directed, "ai_log", None):
        res.reel_plan["aiDirector"] = directed.ai_log  # what the AI decided, shot by shot, and what the safety layer changed
    elif use_director and directed is None:  # said loudly on the project page: this Reel was NOT planned by the AI
        res.reel_plan["directorFallback"] = {"reason": director_errors[0].message if director_errors else "no clip the AI could use"}
    timeline.warnings += [w for w in (f"Quality check: {c.name}. {c.detail}".strip() for c in checks if not c.ok) if w not in timeline.warnings]
    return res


def _transition_budget(style_id: str) -> float:
    """The share of non-cut transitions the Reel's style allows (the reviewer flags anything beyond it)."""
    try:
        return get_style(style_id).max_transition_ratio
    except AppError:
        return 0.5


def _director_key(pid: str, key: str) -> str:
    return project_key(pid, "analysis", f"director_{key}.json")


def direct_reel(inp: PipelineInput, inputs: list[ClipInput], audio: AudioAnalysis, style, storage: StorageBackend,
                warnings: list[str], ai_tasks: list[str], errors: list | None = None):  # fmt: skip
    """The AI creative director plans the edit; the safety layer turns the plan into the Timeline.

    Returns ``DirectedReel`` or None (then the rule-based editor makes the Reel, with a visible warning). The plan is
    cached per (facts, model, version seed): regenerating the same version never calls the model again, while
    "Create another version" (a new seed) asks for a different edit.
    """
    from app.ai.reel_director import ReelDirectorPlan, ask_director, build_request, cache_key
    from app.director.ai_plan import DirectorPlanRejected, plan_to_timeline
    from app.video.timeline import choose_music_window

    ps = inp.settings
    window_warnings: list[str] = []
    audio_start, eff = choose_music_window(audio, float(ps.duration), window_warnings, start=ps.audio_start)
    mm = build_music_map(audio, audio_start, eff)
    styles = {st.id: st.description for st in list_styles() if st.id not in ("custom", AUTO_STYLE)}
    keep_style = ps.style != AUTO_STYLE
    facts, alias = build_request(inputs, audio, mm, audio_start, eff, styles, brief=ps.brief, language=ps.language,
                                 style_hint=style.id if keep_style else None, captions=ps.captions, cta=ps.cta_text,
                                 hook=ps.hook_text, pace=ps.pace, suggested_cuts=suggested_cuts(audio, audio_start, eff, style),
                                 references=inp.references)  # fmt: skip
    if not alias:
        return None
    try:
        provider = get_provider("director")
        key = cache_key(facts, provider.model, inp.seed)
        plan = None
        cached = _load_json(storage, _director_key(inp.project_id, key))
        if cached:
            try:
                plan = ReelDirectorPlan.model_validate(cached)
            except ValueError:
                plan = None
        reused = plan is not None
        revision: dict | None = None

        def check(pl):
            return plan_to_timeline(pl, alias, inputs, mm, audio_start, eff, style, style_ids=set(styles), keep_style=keep_style,
                                    seed=inp.seed, hook_text=ps.hook_text, cta_text=ps.cta_text, pace=ps.pace)  # fmt: skip

        if plan is None:
            plan = ask_director(provider, facts, inp.seed)
            try:
                directed = check(plan)
            except DirectorPlanRejected as exc:  # a plan too broken to repair gets one correction round before the fallback
                log.info("AI director plan rejected (%s); asking the AI to correct it", exc.message)
                plan = ask_director(provider, facts, inp.seed, previous=plan, problems=[exc.message])
                directed = check(plan)
                revision = {"before": 1, "after": 0, "used": True}
            problems = director_problems(directed)
            if revision is not None:
                revision["after"] = len(problems)
            if revision is None and len(problems) >= REVISE_AT:  # the AI corrects its own plan once; the better of the two is used
                revision = {"before": len(problems), "after": len(problems), "used": False}
                try:
                    plan2 = ask_director(provider, facts, inp.seed, previous=plan, problems=problems)
                    directed2 = check(plan2)
                    after = len(director_problems(directed2))
                    revision["after"] = after
                    if after < len(problems):
                        plan, directed, revision["used"] = plan2, directed2, True
                except AppError as exc:
                    log.info("AI director revision skipped: %s", exc.message)
            storage.write_bytes(_director_key(inp.project_id, key), plan.model_dump_json().encode())
        else:
            directed = check(plan)
    except AppError as exc:
        log.warning("AI director skipped: %s", exc.message)
        if errors is not None:
            errors.append(exc)
        warnings.append(f"The AI director was not used ({exc.message}) The Reel was edited by the rule-based editor instead.")
        return None
    tl = directed.timeline
    tl.warnings = window_warnings + tl.warnings
    last = getattr(provider, "last_result", None)
    who = (last.provider if last else provider.name).capitalize()
    tl.notes = [f"AI director ({who}{', reused plan' if reused else ''}): {plan.reason}".rstrip(": ")]
    tl.notes += [f"Safety check: {f}" for f in directed.fixes[:8]]
    if len(directed.fixes) > 8:
        tl.notes.append(f"Safety check: {len(directed.fixes) - 8} more small repairs.")
    if last is not None and last.fallback_used:
        tl.notes.append(f"The main AI provider was unavailable; {last.provider} planned this Reel.")
    ai_tasks.append("director")
    if revision is not None:
        tl.notes.append(f"The AI revised its own plan: {revision['before']} problems before, {revision['after']} after"
                        + ("." if revision["used"] else " (the first plan was kept)."))
    directed.ai_log = {
        "revision": revision,
        "provider": last.provider if last else provider.name, "model": (last.model if last else provider.model) or "",
        "reused": reused, "latencyMs": None if reused or last is None else last.latency_ms,
        "tokens": None if reused or last is None else {"input": last.input_tokens, "output": last.output_tokens},
        "idea": plan.reason, "style": {"asked": plan.style, "used": tl.style}, "grade": {"asked": plan.grade, "used": tl.color_grade},
        "texts": {"asked": [{"text": o.text, "start": o.start, "end": o.end, "role": o.role} for o in plan.overlays],
                  "used": [{"text": o.text, "start": o.start, "end": o.end, "role": o.role} for o in tl.overlays]},
        "shots": directed.log, "fixes": directed.fixes,
    }  # fmt: skip
    log.info("AI director (%s %s%s): %s", directed.ai_log["provider"], directed.ai_log["model"], ", reused plan" if reused else "", plan.reason)
    for row in directed.log:
        u = row["used"]
        log.info("  shot %d %5.2f-%5.2fs %-9s %s %.1f-%.1fs  effect=%s transition=%s speed=%sx%s", row["shot"], u["start"], u["end"],
                 row["purpose"], row["clip"], u["from"], u["to"], u["effect"], u["transition"], u["speed"],
                 ("  | changed: " + "; ".join(row["changes"])) if row["changes"] else "")  # fmt: skip
    return directed


def suggested_cuts(audio: AudioAnalysis, audio_start: float, duration: float, style) -> list[float]:
    """The rule engine's beat-aligned, energy-aware cut times: the rhythm the AI director builds its story on."""
    from app.video.timeline import plan_slots

    try:
        return [sl.start for sl in plan_slots(audio, audio_start, duration, style)[1:]]
    except Exception:  # noqa: BLE001 - a rhythm hint is optional
        return []


def directed_pace(inp: PipelineInput, directed) -> str:
    """The pace the Reel was cut at: the user's choice, else (pace "auto") the one the AI director chose."""
    if inp.settings.pace != "auto":
        return inp.settings.pace
    return getattr(directed, "pace", None) or "balanced"


REVISE_AT = 3  # this many repairs in a plan -> the AI gets one round to correct it


def director_problems(directed) -> list[str]:
    """The rule breaks the safety layer had to repair (beat fine-tuning is not a problem), for the AI's revision round."""
    out = [f"shot {row['shot']}: {c}" for row in directed.log for c in row["changes"]]
    out += [f for f in directed.fixes if "scaled by" in f and not f.startswith("Shot ")]
    out += getattr(directed, "problems", [])  # e.g. "the shots only fill 48s of 60s; unused good footage: c20 18.3-24.4s"
    return out


def ai_info(ai_tasks: list[str], director: bool):
    """Which provider made the AI decisions (for "AI: Gemini" on the project page)."""
    from app.models.timeline import AIInfo

    try:
        p = get_provider("director" if director else ("clip_understanding" if ai_tasks == ["clip_understanding"] else "copy"))
        last = getattr(p, "last_result", None)
        return AIInfo(provider=p.name, model=p.model or "", local=p.is_local, tasks=list(dict.fromkeys(ai_tasks)), director=director,
                      fallback_used=bool(last and last.fallback_used))  # fmt: skip
    except AppError:
        return None


def apply_revision(inp: PipelineInput, timeline: Timeline, res: PipelineResult) -> Timeline:
    """The user's other requests from the same change request ("...and make the music louder"), on the new edit."""
    from app.revise.actions import Action, actions_to_ops
    from app.video.timeline_ops import EditError, OpContext, apply_operations

    actions = [Action(**a) for a in inp.revision]
    audio_dur = res.audio.duration if (res.audio is not None and inp.audio is not None) else None
    ctx = OpContext(
        clip_durations={v.id: res.clips[v.id].metadata.duration for v in inp.videos if v.id in res.clips},
        clip_names={v.id: v.name for v in inp.videos}, audio_duration=audio_dur,
    )  # fmt: skip
    edits, notes, _ = actions_to_ops(actions, timeline, audio_duration=audio_dur)
    try:
        timeline = apply_operations(timeline, edits, ctx) if edits else timeline
    except EditError as e:
        notes.append(f"Some requested changes could not be applied: {e.message}")
    timeline.notes = timeline.notes + [f"Requested: {n}" for n in notes]
    return timeline


def run_variations(inp: PipelineInput, storage: StorageBackend, progress: StageProgress) -> PipelineResult:
    """Several versions of the same Reel, each with a different editing strategy. Media is analysed once."""
    from app.variations.strategies import chronological_hint, get_strategy, version_label

    res = PipelineResult()
    res.clips = analyze_videos(inp, storage, progress)
    res.warnings = skipped_warnings(inp, res.clips)
    inp = drop_duplicate_videos(inp, storage, res.warnings)
    res.audio = analyze_music(inp, storage, progress) if inp.audio is not None else neutral_audio(inp.settings.duration)
    if inp.settings.ai:
        res.semantics = understand_clips(inp, res.clips, storage, progress, res.warnings)
    inputs = [ClipInput(v.id, v.name, res.clips[v.id], res.semantics.get(v.id)) for v in inp.videos]
    base = inp.timeline
    n = max(len(inp.strategies), 1)
    for i, sid in enumerate(inp.strategies):
        st = get_strategy(sid)
        settings = inp.settings.model_copy(update={"style": st.style, "pace": st.pace, "caption_style": st.caption_style})
        duration = base.duration if (base and base.voice) else inp.settings.duration
        hint = chronological_hint([v.id for v in inp.videos]) if st.order == "chronological" else None
        tl = build_timeline(res.audio, inputs, duration, resolve_style(settings), seed=inp.seed + i * 101, order_hint=hint,
                            brief=inp.settings.brief, audio_start=inp.settings.audio_start)  # fmt: skip
        tl.warnings = res.warnings + tl.warnings
        if inp.audio is not None:
            tl.music_hits = song_hits(res.audio)
        tl.notes = [f"{version_label(i, st)}: {st.description}"]
        tl.caption_style = st.caption_style
        if base is not None:  # carry over what the human already set up: brand look, voice-over, captions
            tl.watermark, tl.caption_font, tl.caption_color = base.watermark, base.caption_font, base.caption_color
            tl.music_volume = base.music_volume
            if base.voice is not None or abs(base.duration - tl.duration) < 0.3:
                tl.voice, tl.captions = base.voice, [c.model_copy(deep=True) for c in base.captions]
        rid = inp.variant_ids[i]
        sub = replace(inp, settings=settings, rendering_id=rid)
        render, key = render_edl(sub, tl, res.clips, storage, lambda _s, f, i=i: progress("rendering", (i + f) / n))
        res.variants.append(VariantResult(sid, version_label(i, st), rid, tl, render, key))
    progress("rendering", 1.0)
    return res


def run_render(inp: PipelineInput, storage: StorageBackend, progress: StageProgress) -> PipelineResult:
    """Render a stored timeline as-is (the human may have edited it). Uses cached clip analyses."""
    assert inp.timeline is not None
    res = PipelineResult(timeline=inp.timeline)
    res.clips = analyze_videos(inp, storage, lambda *_: None)  # cache hit for anything already analysed
    res.render, res.output_key = render_edl(inp, inp.timeline, res.clips, storage, progress)
    return res


def render_edl(
    inp: PipelineInput, timeline: Timeline, clips: dict[str, ClipAnalysis], storage: StorageBackend,
    progress: StageProgress,
):
    """Timeline (EDL) -> MP4. The single place where renders happen, for previews and finals."""
    s = get_settings()
    preview = inp.kind == "preview"
    try:
        style = get_style(timeline.style)
    except AppError:
        style = get_style("custom")
    encoder = "libx264" if preview else pick_encoder()
    cfg = config_for(inp.settings.export_preset, "preview" if preview else "final", encoder)
    mode, mode_note = resolve_audio_mode(inp.settings.audio_mode, timeline.voice is not None, inp.audio is not None)
    if mode_note and mode_note not in timeline.warnings:
        timeline.warnings.append(mode_note)
    cfg = replace(cfg, audio_mode=mode)
    final_dims = get_preset(inp.settings.export_preset)  # captions are laid out at final size; libass scales
    sources = {
        v.id: SourceClip(
            storage.local_path(v.key), clips[v.id].metadata.width, clips[v.id].metadata.height, v.name,
            tuple(clips[v.id].content_rect) if clips[v.id].content_rect else None,  # type: ignore[arg-type]
            clips[v.id].metadata.has_audio,
        )
        for v in inp.videos
        if v.id in clips
    }  # fmt: skip
    prefix = "preview_" if preview else ""
    out_key = project_key(inp.project_id, "output", f"{prefix}{inp.rendering_id}.mp4")
    work = storage.local_path(project_key(inp.project_id, "temp", f"render_{inp.rendering_id}"))
    cap_dir = storage.local_path(project_key(inp.project_id, "temp", f"captions_{inp.rendering_id}"))
    audio_file = storage.local_path(inp.audio.key) if inp.audio is not None else None
    voice_file = storage.local_path(timeline.voice.file_key) if timeline.voice is not None else None
    try:
        video_post: list[str] | None = None
        if timeline.captions:
            ass = write_ass(captions_to_cues(timeline.captions), timeline.caption_style, cap_dir / "captions.ass",
                            final_dims.width, final_dims.height, timeline.caption_font, timeline.caption_color)  # fmt: skip
            video_post = [ass_filter(ass)]
        if timeline.overlays:  # hook / benefit / CTA text layers, drawn above the captions
            from app.video.overlays import write_overlays_ass

            txt = write_overlays_ass(timeline, cap_dir / "overlays.ass", final_dims.width, final_dims.height)
            if txt is not None:
                video_post = (video_post or []) + [ass_filter(txt)]
        progress("rendering", 0.0)
        result = render_timeline(
            timeline, sources, audio_file, storage.new_local_path(out_key), work, style, cfg,
            progress=lambda f: progress("rendering", f), timeout=max(s.render_timeout_seconds, timeline.duration * RENDER_SECONDS_PER_SECOND),
            video_post=video_post, free_bytes=storage.free_bytes, voice_path=voice_file,
            watermark_path=storage.local_path(timeline.watermark.logo_key) if timeline.watermark else None,
        )  # fmt: skip
    finally:
        shutil.rmtree(cap_dir, ignore_errors=True)
    storage.commit(out_key)
    return result, out_key


def build_captions(inp: PipelineInput, timeline: Timeline, audio_file: Path, progress: StageProgress) -> None:
    """Transcribe the music window into *editable* caption cues on the timeline.

    Captions are optional polish: if transcription is unavailable or finds no speech, the Reel is
    still rendered and the reason is added to the timeline warnings (never silently dropped).
    """
    progress("generating_captions", 0.0)
    try:
        words = transcribe_window(
            audio_file, timeline.audio_start, timeline.duration, lambda f: progress("generating_captions", f)
        )
        cues = group_words(words, timeline.duration)
        if not cues:
            timeline.warnings.append("Captions: no speech or lyrics were detected in the music, so none were added.")
            return
        timeline.captions = cues_to_captions(cues)
        timeline.caption_style = inp.settings.caption_style
    except AppError as exc:
        log.warning("captions skipped: %s %s", exc.message, exc.details)
        timeline.warnings.append(f"Captions were skipped: {exc.message}")
    finally:
        progress("generating_captions", 1.0)


def resolve_audio_mode(wanted: str, has_voice: bool, has_music: bool) -> tuple[str, str | None]:
    """The audio mode that can actually be rendered, plus a note when it differs from what was asked."""
    if wanted == "voice_music":
        if has_voice and has_music:
            return "voice_music", None
        if has_voice:
            return "voice", "No music was uploaded, so the Reel has the voice-over only."
        if has_music:
            return "music", "There is no voice-over yet (write a script and generate the voice), so only the music is used."
        return "none", "There is no music or voice-over, so the Reel is silent."
    if wanted == "voice":
        if has_voice:
            return "voice", None
        return ("music", "There is no voice-over yet, so the music is used.") if has_music else ("none", "There is no voice-over, so the Reel is silent.")
    if wanted == "music":
        return ("music", None) if has_music else ("none", "No music was uploaded, so the Reel is silent.")
    return wanted, None  # original | none


def neutral_audio(duration: float) -> AudioAnalysis:
    """A steady 110 BPM grid for Reels without music (voice, original audio or silent): cuts still land on a rhythm."""
    period = 60.0 / 110
    total = max(float(duration) + 5.0, 10.0)
    beats = [round(i * period, 3) for i in range(int(total / period))]
    hop = 0.1
    return AudioAnalysis(
        bpm=110.0, duration=total, beats=beats, beat_confidence=0.0, strong_beats=beats[::4], onsets=beats,
        high_energy_sections=[], sections=[Section(start=0.0, end=total)], drops=[], energy_hop=hop,
        energy=[0.5] * int(total / hop),
    )  # fmt: skip


def fallback_style(clips: list[ClipInput], audio: AudioAnalysis) -> str:
    """Deterministic 'auto' style when no AI is available: tempo, motion and framing."""
    usable = [c for c in clips if c.analysis.usable] or clips
    motion = sum(c.analysis.motion_score for c in usable) / len(usable)
    landscape = sum(c.analysis.metadata.orientation == "landscape" for c in usable) / len(usable)
    if audio.bpm >= 110 and motion >= 0.35:
        return "fast_trending"
    if landscape >= 0.6 and motion < 0.35:
        return "travel"
    return "cinematic"


def choose_style_and_order(
    inp: PipelineInput, clips: list[ClipInput], audio: AudioAnalysis, notes: list[str], warnings: list[str],
    use_ai: bool = True, ai_tasks: list[str] | None = None,
) -> tuple[str | None, dict[str, float] | None]:
    """AI-assisted decisions with a safe fallback for each. Returns (resolved style id, order hint)."""
    style_id: str | None = None if inp.settings.style != AUTO_STYLE else fallback_style(clips, audio)
    order_hint: dict[str, float] | None = None
    ai_tasks = ai_tasks if ai_tasks is not None else []
    if inp.settings.ai and use_ai:
        try:
            if inp.settings.style == AUTO_STYLE:
                sug = suggest_style(get_provider("style"), list_styles(), clips, audio, inp.project_name)
                style_id = sug.style_id
                ai_tasks.append("style")
                notes.append(f"AI chose the {sug.style_id} style" + (f": {sug.reason}" if sug.reason else "."))
            semantic_ready = any(c.semantic is not None for c in clips)
            if inp.settings.brief and semantic_ready:
                story = plan_story(get_provider("story"), inp.settings.brief, inp.settings.language, clips, inp.settings.duration)
                order_hint = story_order_hint(story, [c.clip_id for c in clips])
                ai_tasks.append("story")
                notes.append("Story: " + " -> ".join(story.structure) + (f". {story.reason}" if story.reason else ""))
            else:
                order = suggest_clip_order(get_provider("order"), clips, audio, inp.settings.duration)
                order_hint = order.hint
                ai_tasks.append("order")
                notes.append("AI suggested the clip order" + (f": {order.reason}" if order.reason else "."))
        except AppError as exc:
            log.warning("AI assist skipped: %s", exc.message)
            warnings.append(f"AI assist was skipped: {exc.message}")
    if inp.settings.ai and not use_ai:  # the AI director decides style and order itself
        return style_id, order_hint
    agents = plan_agents(
        ai_on=inp.settings.ai, style_auto=inp.settings.style == AUTO_STYLE, has_brief=bool(inp.settings.brief),
        semantic_ready=any(c.semantic is not None for c in clips), audio_mode=inp.settings.audio_mode,
        captions=inp.settings.captions,
    )  # fmt: skip
    notes.append("Agents used: " + ", ".join(a.replace("_", " ") for a in agents.run)
                 + (f". Waiting for your approval: {', '.join(a.replace('_', ' ') for a in agents.pending_human)}." if agents.pending_human else ""))  # fmt: skip
    if inp.settings.style == AUTO_STYLE and style_id and not any("AI chose" in n for n in notes):
        notes.append(f"Auto style picked {style_id} from the music tempo and footage.")
    return style_id, order_hint


def write_copy(inp: PipelineInput, timeline: Timeline, audio: AudioAnalysis, progress: StageProgress) -> dict | None:
    progress("writing_copy", 0.0)
    try:
        copy = generate_post_copy(
            get_provider("copy"), inp.project_name, timeline.style, audio.bpm, timeline.duration, [v.name for v in inp.videos]
        )
        return copy.to_doc()
    except AppError as exc:
        log.warning("copy generation skipped: %s", exc.message)
        timeline.warnings.append(f"Title/description were skipped: {exc.message}")
        return None
    finally:
        progress("writing_copy", 1.0)


# ------------------------------------------------------------------ product Reels (directed from photos)
def _image_key(pid: str, mid: str) -> str:
    return project_key(pid, "analysis", f"product_{mid}.json")


def understand_images(inp: PipelineInput, storage: StorageBackend, progress: StageProgress):
    """Understand every photo once; the result is cached next to the project."""
    from app.product.models import ImageUnderstanding
    from app.product.understand import understand_image

    out: list[ImageUnderstanding] = []
    n = max(len(inp.images), 1)
    for i, im in enumerate(inp.images):
        progress("understanding_images", i / n)
        cached = _load_json(storage, _image_key(inp.project_id, im.id))
        if cached:
            try:
                out.append(ImageUnderstanding.model_validate(cached))
                continue
            except ValueError:
                pass
        u = understand_image(storage.local_path(im.key), im.id, im.name)
        storage.write_bytes(_image_key(inp.project_id, im.id), json.dumps(u.to_doc()).encode())
        out.append(u)
    progress("understanding_images", 1.0)
    return out


def make_product_plan(inp: PipelineInput, storage: StorageBackend, progress: StageProgress):
    """Everything up to (and including) the director's shot list: no frame is rendered. Returns (plan, style)."""
    from app.product.director import plan_reel
    from app.product.styles import get_product_style
    from app.video.timeline import choose_music_window

    ps = inp.settings
    style = get_product_style(ps.product_style)
    audio: AudioAnalysis | None = analyze_music(inp, storage, progress) if inp.audio is not None else None
    if audio is None:
        progress("analyzing_music", 1.0)
        progress("detecting_beats", 1.0)
    images = understand_images(inp, storage, progress)
    warnings: list[str] = []
    for u in images:
        warnings += [f"{u.name or 'photo'}: {n}" for n in u.notes if "not" in n.lower() or "limited" in n.lower() or "estimate" in n.lower()]
    progress("planning_shots", 0.0)
    if audio is not None:
        audio_start, eff = choose_music_window(audio, float(ps.duration), warnings, start=ps.audio_start)
    else:
        audio_start, eff = 0.0, float(ps.duration)
    hook, tagline, cta = ps.hook_text, ps.tagline_text, ps.cta_text
    direction = direct_product(inp, images, style, eff, audio, storage, warnings) if ps.ai and ps.ai_director else None
    extra: dict = {}
    if direction is not None:
        d, info, post_copy = direction
        style, hook, tagline, cta = d.style, d.hook, d.tagline, d.cta
        extra = {"phases": d.phases, "cameras": d.cameras, "text_animations": d.animations, "transitions": d.transitions}
    plan = plan_reel(images, audio, style=style, duration=eff, audio_start=audio_start, hook=hook, tagline=tagline,
                     cta=cta, loop=ps.loop, seed=inp.seed, fps=30 if inp.kind != "preview" else 24, **extra)  # fmt: skip
    if direction is not None:
        plan.concept["ai"] = info
        plan.notes = [f"Safety check: {n}" for n in d.notes] + plan.notes
        plan.post_copy = post_copy
    plan.warnings = warnings + plan.warnings
    progress("planning_shots", 1.0)
    return plan, style


def direct_product(inp: PipelineInput, images, style, duration: float, audio: AudioAnalysis | None, storage: StorageBackend,
                   warnings: list[str]):  # fmt: skip
    """AI creative direction for a product Reel -> (validated Direction, concept line, post copy) or None (built-in concept)."""
    from app.ai.product_director import ProductDirection, ask_product_director, build_request, cache_key, small_photos
    from app.product.director import apply_direction

    ps = inp.settings
    facts = build_request(images, duration, style.name, brief=ps.brief, language=ps.language, hook=ps.hook_text, tagline=ps.tagline_text,
                          cta=ps.cta_text, bpm=audio.bpm if audio else None)  # fmt: skip
    try:
        provider = get_provider("product_understanding")  # it looks at the photos: the vision provider/model
        key = cache_key(facts, provider.vision_model or provider.model, inp.seed)
        cached = _load_json(storage, project_key(inp.project_id, "analysis", f"product_director_{key}.json"))
        direction = None
        if cached:
            try:
                direction = ProductDirection.model_validate(cached)
            except ValueError:
                direction = None
        if direction is None:
            photos = small_photos([storage.local_path(im.key) for im in inp.images], get_settings().vision_max_image_size * 2)
            direction = ask_product_director(provider, facts, photos, inp.seed)
            storage.write_bytes(project_key(inp.project_id, "analysis", f"product_director_{key}.json"), direction.model_dump_json().encode())
        d = apply_direction(direction, style, duration, images, hook=ps.hook_text, tagline=ps.tagline_text, cta=ps.cta_text)
    except AppError as exc:
        log.warning("AI product director skipped: %s", exc.message)
        warnings.append(f"The AI director was not used ({exc.message}) The built-in product concept was used instead.")
        return None
    who = provider.name.capitalize()
    info = f"AI director ({who}): {prompts_clean(direction.product)} — {prompts_clean(direction.reason)}".strip(" —:")
    tags = []
    for t in direction.hashtags:
        tag = "".join(ch for ch in str(t) if ch.isalnum() or ch == "_")[:30]
        if tag and tag.lower() not in {x.lower() for x in tags}:
            tags.append(tag)
    copy = {"title": prompts_clean(direction.title, 60), "description": prompts_clean(direction.description, 200), "hashtags": tags[:8]}
    return d, info, (copy if copy["title"] or copy["description"] else None)


def prompts_clean(text: str, limit: int = 200) -> str:
    from app.ai.prompts import clean

    return clean(text or "", limit)


def run_product(inp: PipelineInput, storage: StorageBackend, progress: StageProgress) -> PipelineResult:
    """photos -> understanding -> music -> micro-timeline -> frames -> MP4."""
    from app.core.ffmpeg import probe
    from app.product.render import FINAL, PREVIEW, render_reel

    res = PipelineResult()
    plan, style = make_product_plan(inp, storage, progress)
    res.product_plan = plan.to_doc()
    res.warnings = plan.warnings
    res.post_copy = plan.post_copy
    prefix = "preview_" if inp.kind == "preview" else ""
    out_key = project_key(inp.project_id, "output", f"{prefix}{inp.rendering_id}.mp4")
    work = storage.local_path(project_key(inp.project_id, "temp", f"product_{inp.rendering_id}"))
    paths = [storage.local_path(next(im.key for im in inp.images if im.id == mid)) for mid in plan.images]
    music = storage.local_path(inp.audio.key) if inp.audio is not None else None
    try:
        render_reel(plan, paths, style, storage.new_local_path(out_key), work, music=music, settings=PREVIEW if inp.kind == "preview" else FINAL,
                    progress=lambda f: progress("rendering", f))  # fmt: skip
    finally:
        shutil.rmtree(work, ignore_errors=True)
    storage.commit(out_key)
    info = probe(storage.local_path(out_key))
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    res.render = RenderResult(path=storage.local_path(out_key), duration=float(info["format"]["duration"]), width=int(v["width"]),
                              height=int(v["height"]), size=storage.local_path(out_key).stat().st_size)  # fmt: skip
    res.output_key = out_key
    return res
