"""Director intelligence: hook ranking, the hero moment on the drop, motion matching, reasons, and the Quality
Reviewer's score + auto-revise loop."""

from __future__ import annotations

from app.director import intelligence as intel
from app.director.creative_review import TARGET_SCORE, auto_revise, review_edit
from app.director.music_map import build_music_map
from app.director.review import review_timeline
from app.models.analysis import UsableWindow
from app.models.timeline import Transition
from app.styles import get_style
from app.video.timeline import build_timeline
from tests.test_timeline import make_audio, make_clip


def _win(start, end, quality, motion, sig_bin, pan_x=0.0, face=False):
    sig = [0.0] * 24
    sig[sig_bin] = 1.0
    return UsableWindow(start=start, end=end, quality=quality, motion=motion, brightness=0.5, sharpness=quality, signature=sig,
                        motion_curve=[motion] * int((end - start) / 0.25), curve_dt=0.25, pan_x=pan_x, face=face)  # fmt: skip


def _clips():
    return [
        make_clip("dull", windows=[_win(0, 8, 0.45, 0.1, 0)]),
        make_clip("star", windows=[_win(0, 8, 0.95, 0.65, 4, face=True)]),
        make_clip("mid_a", windows=[_win(0, 8, 0.7, 0.4, 8)]),
        make_clip("mid_b", windows=[_win(0, 8, 0.7, 0.45, 12)]),
        make_clip("mid_c", windows=[_win(0, 8, 0.68, 0.5, 16)]),
    ]


def test_window_direction_from_pan():
    assert _win(0, 2, 0.8, 0.5, 0, pan_x=0.3).direction == "right"
    assert _win(0, 2, 0.8, 0.5, 0, pan_x=-0.3).direction == "left"
    assert _win(0, 2, 0.8, 0.5, 0, pan_x=0.01).direction == "still"


def test_rank_hooks_three_best_first():
    hooks = intel.rank_hooks(_clips())
    assert len(hooks) == 3
    assert hooks[0].clip_id == "star"
    assert hooks[0].score >= hooks[1].score >= hooks[2].score
    assert "dull" not in [h.clip_id for h in hooks]
    assert hooks[0].reason  # a plain-language explanation


def test_motion_match():
    right, left, still = (_win(0, 2, 0.8, 0.5, 0, pan_x=p) for p in (0.3, -0.3, 0.0))
    assert intel.motion_match(right, right) == 1.0
    assert intel.motion_match(right, left) == -1.0
    assert intel.motion_match(still, right) == 0.0


def test_rule_editor_opens_on_the_best_hook_and_explains_every_shot():
    tl = build_timeline(make_audio(duration=30), _clips(), 15, get_style("fast_trending"), seed=0)
    assert tl.segments[0].clip_id == "star"
    assert all(s.reason for s in tl.segments)
    assert "openings" in tl.segments[0].reason


def test_hero_moment_is_kept_for_the_drop():
    clips = [make_clip(f"c{i}", windows=[_win(0, 8, 0.6, 0.3, i * 4)]) for i in range(5)]
    clips.append(make_clip("hero", windows=[_win(0, 3, 0.98, 0.9, 20)]))
    audio = make_audio(duration=30, loud_from=8.0, drops=(8.0,))
    tl = build_timeline(audio, clips, 15, get_style("fast_trending"), seed=0)
    hero = intel.find_hero(clips)
    assert hero is not None and hero.clip_id == "hero"
    on_hero = [s for s in tl.segments if s.clip_id == "hero" and s.source_start < hero.end and s.source_end > hero.start]
    assert on_hero, "the strongest moment is used"
    assert all(s.timeline_start >= 7.0 for s in on_hero)  # never wasted before the drop
    assert any("drop" in (s.reason or "") or "peak" in (s.reason or "") for s in on_hero)


def test_review_scores_and_flags_problems():
    clips = _clips()
    audio = make_audio(duration=30)
    tl = build_timeline(audio, clips, 15, get_style("fast_trending"), seed=0)
    mm = build_music_map(audio, tl.audio_start, tl.duration)
    good = review_edit(tl, clips, mm, max_transition_ratio=0.3)
    assert 0 <= good.overall_score <= 100 and set(good.categories) >= {"hook", "pacing", "story", "diversity", "beat"}

    bad = tl.model_copy(deep=True)
    dull = clips[0]
    s0 = bad.segments[0]
    s0.clip_id, s0.video, s0.source_start, s0.source_end = "dull", dull.name, 0.0, s0.length
    for s in bad.segments[1:]:
        s.transition_in = Transition(type="dissolve", duration=0.2)
    r = review_edit(bad, clips, mm, max_transition_ratio=0.3)
    probs = " ".join(i.problem for i in r.issues)
    assert "weak opening" in probs and "too many transitions" in probs
    assert r.overall_score < good.overall_score
    assert all(i.severity in ("high", "medium", "low") for i in r.issues)


def test_auto_revise_fixes_a_weak_edit_and_never_makes_it_worse():
    clips = _clips()
    audio = make_audio(duration=30)
    tl = build_timeline(audio, clips, 15, get_style("fast_trending"), seed=0)
    mm = build_music_map(audio, tl.audio_start, tl.duration)
    s0 = tl.segments[0]
    s0.clip_id, s0.video, s0.source_start, s0.source_end = "dull", "dull.mp4", 0.0, s0.length
    for s in tl.segments[1:]:
        s.transition_in = Transition(type="dissolve", duration=0.2)
    before = review_edit(tl, clips, mm, max_transition_ratio=0.3).overall_score
    fixed, review = auto_revise(tl, clips, mm, max_transition_ratio=0.3,
                                repair=lambda t: review_timeline(t, clips, mm))  # fmt: skip
    assert review.overall_score > before
    assert review.iterations and review.iterations[0]["kept"]
    assert fixed.segments[0].clip_id == "star"
    assert sum(1 for s in fixed.segments[1:] if s.transition_in.type != "cut") <= 0.3 * (len(fixed.segments) - 1) + 1e-6
    assert abs(fixed.total_segment_duration - fixed.duration) < 0.05
    assert review.overall_score >= before and (review.overall_score >= TARGET_SCORE or len(review.iterations) <= 2)


def test_creative_modes_give_meaningfully_different_edits():
    clips = _clips()
    audio = make_audio(duration=40, loud_from=10.0, drops=(10.0,))
    tls = {m: build_timeline(audio, clips, 20, get_style(m), seed=0) for m in ("viral", "energetic", "product_focus", "social_native", "cinematic")}
    shots = {m: len(t.segments) for m, t in tls.items()}
    assert shots["viral"] > shots["cinematic"] and shots["energetic"] > shots["product_focus"]
    assert all(s.transition_in.type == "cut" for s in tls["social_native"].segments)  # creator style: no fancy transitions
    assert tls["viral"].segments[0].clip_id == "star"  # the strongest hook
    # product focus prefers framed subjects (the face shot) over general footage
    pf = tls["product_focus"]
    share = sum(s.length for s in pf.segments if s.clip_id == "star") / pf.duration
    vir = sum(s.length for s in tls["viral"].segments if s.clip_id == "star") / tls["viral"].duration
    assert share >= vir
    edits = {tuple((s.clip_id, round(s.source_start, 1), round(s.length, 2), s.effect, s.transition_in.type) for s in t.segments)
             for t in tls.values()}
    assert len(edits) == len(tls)  # five modes, five different edits
