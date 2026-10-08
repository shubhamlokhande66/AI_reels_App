"""Phase 2.7-2.9: the Reviewer's score card, the AI reviewer, the self-correction loop, edit patches from words and
manual edits that automatic changes never undo."""

from __future__ import annotations

import json

import pytest

from app.ai.provider import set_provider
from app.ai.reviewer import FIXES, ask_reviewer, review_facts
from app.director.creative_review import CreativeReview, Issue, auto_revise, review_edit, revise_once
from app.director.music_map import build_music_map
from app.director.scorecard import SCORE_KEYS, scorecard, weakest
from app.director.self_correct import audio_fixes, correct
from app.quality.checker import Issue as FileIssue
from app.revise.actions import parse_rules
from app.revise.director_patch import apply_patches, to_patch
from app.revise.inplace import apply_style_pace
from app.styles import get_style
from app.video.timeline import build_timeline
from app.video.timeline_ops import OpContext, SetEffect, SetLock, Split, Trim, apply_operations, mark_manual
from tests.test_ai import FakeProvider
from tests.test_timeline import make_audio, make_clip


@pytest.fixture(autouse=True)
def _reset():
    yield
    set_provider(None)


def _edit(duration=12.0, n=5):
    audio = make_audio(duration=40, loud_from=6, drops=(6.0,))
    clips = [make_clip(f"c{i}", dur=8.0, motion=0.15 + 0.15 * i, quality=0.5 + 0.08 * i, sig_bin=i * 4) for i in range(n)]
    tl = build_timeline(audio, clips, duration, get_style("fast_trending"), seed=3)
    return tl, clips, build_music_map(audio, tl.audio_start, tl.duration)


# ---------------------------------------------------------------------- score card
def test_scorecard_has_the_ten_scores_and_measures_audio_and_brand():
    tl, clips, mm = _edit()
    rv = review_edit(tl, clips, mm)
    clean = scorecard(rv, timeline=tl, file_issues=[], brief={"style": "luxury", "cta": "Shop now", "inferred": []}, brand=None)
    assert {"overallScore", "hook", "story", "pacing", "musicSync", "visualQuality", "brandFit", "textReadability", "audio", "ending",
            "retention", "issues", "threshold"} <= set(clean)  # fmt: skip
    assert all(0 <= clean[k] <= 100 for k in ("overallScore", "hook", "audio", "brandFit"))
    assert clean["audio"] == 100
    # the brand look is not the edit's style and the CTA never shows: brand fit drops, and says why
    assert clean["brandFit"] <= 55 and any("call to action" in i for i in clean["issues"])
    bad = scorecard(rv, timeline=tl, file_issues=[FileIssue("AUDIO_CLIPPING", "warning", "The audio clips."),
                                                  FileIssue("MUSIC_ABRUPT_END", "warning", "Cut off.")], brief=None, brand=None)  # fmt: skip
    assert bad["audio"] == 60 and bad["ending"] < clean["ending"] and bad["overallScore"] < clean["overallScore"]
    assert weakest(bad, 1) == ["audio"] or bad["audio"] <= min(bad[k] for k in ("hook", "story"))
    assert len(SCORE_KEYS) == 10


# ---------------------------------------------------------------------- AI reviewer
def test_ai_reviewer_names_fixes_only_from_the_vocabulary():
    tl, clips, mm = _edit()
    card = scorecard(review_edit(tl, clips, mm), timeline=tl, file_issues=[])
    reply = {"summary": "the middle sags", "fixes": [{"fix": "strengthen_middle", "at": 6.0, "problem": "weak middle"},
                                                     {"fix": "rm -rf /", "problem": "nope"}, {"fix": "lower_music"}],
             "advice": ["shoot a close-up next time"]}  # fmt: skip
    fake = FakeProvider([json.dumps(reply)])
    ans = ask_reviewer(fake, card, tl, {"concept": "x"})
    assert [f.fix for f in ans.fixes] == ["strengthen_middle", "lower_music"] and all(f.fix in FIXES for f in ans.fixes)
    facts = review_facts(card, tl, None)
    assert "shots" in facts and "scores" in facts and all("locked" in s for s in facts["shots"])


# ---------------------------------------------------------------------- self-correction
def test_audio_fixes_from_the_rendered_file():
    tl, _, _ = _edit()
    tl.music_volume, tl.music_fade_out = 1.0, None
    done = audio_fixes(tl, [FileIssue("AUDIO_CLIPPING", "warning", ""), FileIssue("MUSIC_ABRUPT_END", "warning", "")], [])
    assert tl.music_volume == 0.85 and tl.music_fade_out == 1.5 and len(done) == 2
    tl2, _, _ = _edit()
    audio_fixes(tl2, [FileIssue("AUDIO_LOUDNESS", "warning", "", details={"lufs": -20.0})], [])
    assert tl2.music_volume > 1.0  # too quiet -> louder


def test_correction_never_touches_a_locked_shot():
    tl, clips, mm = _edit()
    first = tl.segments[0].model_copy()
    tl.segments[0].locked = True
    review = CreativeReview(50, {}, [Issue(0.0, "weak opening", "high", "hook", "replace_opening")])
    cand, changes = correct(tl, review, [], [], clips, mm)
    assert cand.segments[0].clip_id == first.clip_id and cand.segments[0].source_start == first.source_start
    assert not any("opening" in c for c in changes)
    # unlocked, the same correction does replace the opening (when a stronger one exists)
    tl.segments[0].locked = False
    weak = min(clips, key=lambda c: c.analysis.quality_score)
    tl.segments[0].clip_id, tl.segments[0].video = weak.clip_id, weak.name
    _, changes2 = correct(tl, review, [], [], clips, mm)
    assert any("opening" in c for c in changes2)


def test_locked_shots_survive_auto_revise_and_restyle():
    tl, clips, mm = _edit()
    for s in tl.segments:
        s.locked = True
        s.effect = "zoom_in"
    revised, _ = auto_revise(tl, clips, mm)
    assert [(s.clip_id, s.source_start) for s in revised.segments] == [(s.clip_id, s.source_start) for s in tl.segments]
    restyled, _ = apply_style_pace(tl, style="minimal", pace="fast", mm=mm, clip_lengths={c.clip_id: 8.0 for c in clips})
    assert len(restyled.segments) == len(tl.segments) and all(s.effect == "zoom_in" for s in restyled.segments)


# ---------------------------------------------------------------------- human override
def test_hand_edits_lock_the_shots_they_touch():
    tl, clips, _ = _edit()
    ctx = OpContext(clip_durations={c.clip_id: 8.0 for c in clips})
    a, b = tl.segments[1], tl.segments[3]
    ops = [SetEffect(segment_id=a.id, effect="zoom_out"), Split(segment_id=b.id, at=round((b.timeline_start + b.timeline_end) / 2, 3))]
    out = mark_manual(apply_operations(tl, ops, ctx), ops)
    locked = [i for i, s in enumerate(out.segments) if s.locked]
    assert locked == [1, 3, 4]  # the edited shot, and both halves of the split
    unlocked = apply_operations(out, [SetLock(segment_id=out.segments[1].id, locked=False)], ctx)
    assert not unlocked.segments[1].locked
    assert not any(s.locked for s in mark_manual(apply_operations(tl, [], ctx), []).segments)
    assert Trim  # (trim is one of the manual shot edits too)


# ---------------------------------------------------------------------- conversational patches
@pytest.mark.parametrize("text,kind", [
    ("Make the first 3 seconds stronger", "replace_hook"), ("Change the hook", "replace_hook"),
    ("Use the music drop for the product reveal", "drop_reveal"), ("Show the product earlier", "product_earlier"),
    ("Make it 15 seconds", "duration"), ("Remove unnecessary transitions", "transition"), ("Make it more premium", "style"),
    ("Make it more cinematic", "style"), ("Make it faster", "pace"),
])  # fmt: skip
def test_spoken_requests_become_structured_patches(text, kind):
    actions, unknown = parse_rules(text)
    assert not unknown and actions[0].kind == kind
    p = to_patch(actions[0])
    assert {"operation", "target", "reason"} <= set(p) and p["reason"] == "user_request"
    if kind == "replace_hook":
        assert p == {"operation": "replace_hook", "target": "timeline[0]", "reason": "user_request"}
    assert parse_rules("change the hook text to Hello")[0][0].kind == "hook_text"  # on-screen text is not a new opening


def test_director_patches_keep_the_cuts():
    tl, clips, mm = _edit(n=6)
    weak = min(clips, key=lambda c: c.analysis.quality_score)
    tl.segments[0].clip_id, tl.segments[0].video = weak.clip_id, weak.name
    tl.segments[0].locked = True  # named by the request, so it may change
    cuts = [(s.timeline_start, s.timeline_end) for s in tl.segments]
    out, notes = apply_patches(tl, ["replace_hook", "product_earlier", "drop_reveal"], clips, mm)
    assert [(s.timeline_start, s.timeline_end) for s in out.segments] == cuts  # rhythm and music sync unchanged
    assert out.segments[0].clip_id != weak.clip_id and out.segments[0].locked  # changed on request, then kept as the person's choice
    assert notes and all(isinstance(n, str) for n in notes)
    for s in out.segments:
        assert 0 <= s.source_start < s.source_end <= 8.0 + 1e-6


# ---------------------------------------------------------------------- 2.10 reference traits
def test_reference_traits_in_the_directors_vocabulary():
    from app.trends.reference import measure, traits

    cuts = [1.0, 2.6, 4.0, 5.2, 6.2, 7.0, 7.7, 8.3, 8.8]  # shots get shorter: rising energy
    p = measure(cuts, 9.3)
    p["described"] = {"transitions": ["cut"], "text_on_screen": "hook only", "effects": ["zoom"]}
    p["look"] = {"brightness": 0.7, "saturation": 0.6}
    t = traits(p)
    assert t["energy_curve"] == "rising" and t["transition_style"] == "mostly_hard_cut" and t["text_density"] == "low"
    assert t["average_shot_duration"] == p["avg_shot"] and t["color_mood"] == "bright vivid" and t["pacing"] == p["pace"]
    assert traits(measure([], 6.0))["transition_style"] == "not_measured"  # never claims what was not seen


# ---------------------------------------------------------------------- 2.11 personal director + observability
def test_profile_learns_the_concept_and_shot_range():
    from app.services.feedback import build_profile

    events = [{"event": "accepted", "facts": {"avgShot": s, "duration": 15, "style": "luxury", "concept": "cinematic"}} for s in (0.8, 1.0, 1.1, 1.2)]
    events += [{"event": "chose_concept", "facts": {"concept": "cinematic"}}, {"event": "removed_transition", "facts": {}},
               {"event": "removed_transition", "facts": {}}]  # fmt: skip
    prof = build_profile(events)
    assert prof.ready and prof.preferences["concept"] == "cinematic" and prof.preferences["pace"] == "fast"
    assert prof.preferences["shotRange"] == [1.0, 1.2] and prof.preferences["transitions"] == "minimal"
    assert prof.to_doc()["summary"] == {"preferred_pacing": "fast", "transition_preference": "minimal", "style": "luxury",
                                        "concept": "cinematic", "shot_range": [1.0, 1.2]}  # fmt: skip


def test_generation_record_has_everything_needed_to_debug():
    from bson import ObjectId

    from app.jobs.pipeline import PipelineResult
    from app.services.generations import generation_doc

    tl, _, _ = _edit()
    tl.creative_plan = {"concept": "Scroll-Stopper", "direction": "viral"}
    res = PipelineResult(timeline=tl, output_key="projects/x/output/y.mp4",
                         reel_plan={"scorecard": {"overallScore": 81}, "selfCorrection": [{"kept": True}, {"kept": False}]})  # fmt: skip
    d = generation_doc(ObjectId(), ObjectId(), "generate", ObjectId(), res)
    assert d["edlVersion"] == "2.0" and d["reviewerScore"] == 81 and d["correctionIterations"] == 2 and d["correctionsKept"] == 1
    assert {"audio", "video", "semantic"} <= set(d["analysisVersion"]) and d["creativePlan"]["concept"] == "Scroll-Stopper"
    assert d["output"].endswith(".mp4")


# ---------------------------------------------------------------------- hard checks (found on a real Gemini Reel)
def test_ending_repair_keeps_the_last_cut_on_a_beat():
    from app.director.review import MIN_ENDING, review_timeline

    tl, clips, mm = _edit()
    last, prev = tl.segments[-1], tl.segments[-2]
    cut = round(tl.duration - 0.5, 3)  # a too-short ending on the beat grid
    shift = cut - last.timeline_start
    prev.timeline_end, prev.source_end = cut, round(prev.source_end + shift * prev.speed, 3)
    last.timeline_start, last.source_start = cut, round(last.source_start + shift * last.speed, 3)
    checks = review_timeline(tl, clips, mm)
    beat = next(c for c in checks if "beat" in c.name and "Cuts" in c.name)
    assert tl.segments[-1].length >= MIN_ENDING - 1e-6 and beat.ok, beat.detail
    assert min(abs(p - tl.segments[-1].timeline_start) for p in mm.snap_points) <= 0.06


def test_a_dragging_shot_is_split_even_when_the_score_is_high():
    tl, clips, mm = _edit(duration=12.0)
    review = review_edit(tl, clips, mm)
    long_loud = [i for i in review.issues if i.fix == "split_long_shot"]
    if not long_loud:  # make one: merge two shots in the loud part into one long shot
        k = next(i for i, s in enumerate(tl.segments[:-1]) if s.timeline_start >= 6.5)
        a = tl.segments[k]
        while a.length < 3.5 and k + 2 < len(tl.segments):  # one shot holding through ~3.5 s of loud music
            nxt = tl.segments.pop(k + 1)
            a.timeline_end = nxt.timeline_end
        a.speed = 1.0
        a.source_start = 0.0
        a.source_end = round(a.length, 3)
        review = review_edit(tl, clips, mm)
    assert any(i.fix == "split_long_shot" for i in review.issues)
    from app.director import creative_review as cr

    old = cr.TARGET_SCORE
    cr.TARGET_SCORE = 0  # the overall score counts as "good": only the failed hard check may be repaired
    try:
        out, after = auto_revise(tl, clips, mm)
    finally:
        cr.TARGET_SCORE = old
    assert len(out.segments) > len(tl.segments) and not any(i.fix == "split_long_shot" for i in after.issues)
