"""Every Reel uses only the GOOD parts of each clip and never shows the same moment twice. The one allowed exception is
a slow-motion replay (a speed effect), used only when every good moment is already on screen."""

from __future__ import annotations

import pytest

from app.ai.reel_director import ReelDirectorPlan, clip_facts
from app.director.ai_plan import plan_to_timeline
from app.director.music_map import build_music_map
from app.models.analysis import UsableWindow
from app.styles import get_style, list_styles
from app.video import footage
from app.video.timeline import build_timeline
from tests.test_timeline import make_audio, make_clip

STYLES = {s.id for s in list_styles() if s.id not in ("custom", "auto")}


def win(a, b, q=0.8):
    return UsableWindow(start=a, end=b, quality=q, motion=0.4, brightness=0.6, sharpness=0.8)


def overlaps(segs):
    """(shot i, shot j) pairs that show the same moment of the same clip."""
    out = []
    for i, a in enumerate(segs):
        for j, b in enumerate(segs[i + 1 :], i + 1):
            if a.clip_id == b.clip_id and footage.overlap_seconds(a.source_start, a.source_end, [(b.source_start, b.source_end)]) > footage.OVERLAP_TOLERANCE:
                out.append((i, j))
    return out


def inside_good_parts(seg, clip):
    return any(w.start - 1e-3 <= seg.source_start and seg.source_end <= w.end + 1e-3 for w in clip.analysis.windows)


# ---------------------------------------------------------------------- the helper
def test_free_spans_are_good_parts_minus_what_was_shown():
    ws = [win(0, 4), win(6, 10)]
    spans = [(a, b) for a, b, _ in footage.free_spans(ws, [(1, 2), (6, 10)])]
    assert spans == [(0, 1), (2, 4)]
    a, b, _ = footage.place(ws, 1.5, [(0, 2)], near=0.2)
    assert (a, b) == (2.0, 3.5)  # nearest fresh good moment to what was asked
    assert footage.place(ws, 5.0, []) is None  # no good part is that long


# ---------------------------------------------------------------------- rule-based editor
@pytest.mark.parametrize("style_id", ["fast_trending", "cinematic", "luxury"])
def test_rules_never_repeat_a_moment_when_there_is_enough_good_footage(style_id):
    clips = [make_clip(f"c{i}", dur=12.0, sig_bin=i * 3) for i in range(4)]  # 48 s of good footage for a 20 s Reel
    tl = build_timeline(make_audio(duration=40), clips, 20, get_style(style_id), seed=3)
    assert overlaps(tl.segments) == []
    by = {c.clip_id: c for c in clips}
    assert all(inside_good_parts(s, by[s.clip_id]) for s in tl.segments)
    assert not any("replay" in w for w in tl.warnings)


def test_rules_skip_the_bad_part_of_a_clip():
    good_then_bad = make_clip("x", dur=12.0, windows=[win(0.0, 3.0), win(8.0, 12.0)])  # 3-8 s is dark / shaky
    others = [make_clip(f"o{i}", dur=8.0, sig_bin=i + 5) for i in range(3)]
    tl = build_timeline(make_audio(duration=40), [good_then_bad, *others], 15, get_style("cinematic"), seed=1)
    for s in tl.segments:
        if s.clip_id == "x":
            assert s.source_end <= 3.0 + 1e-3 or s.source_start >= 8.0 - 1e-3, (s.source_start, s.source_end)


def test_short_footage_uses_slow_motion_and_a_replay_only_as_the_last_resort():
    clips = [make_clip("a", dur=4.0), make_clip("b", dur=4.0, sig_bin=6)]  # 8 s of footage for a 20 s Reel
    tl = build_timeline(make_audio(duration=40), clips, 20, get_style("fast_trending"), seed=2)
    pairs = overlaps(tl.segments)
    for i, j in pairs:  # any moment shown again is a visibly slowed-down replay
        assert tl.segments[j].speed <= footage.REPLAY_SPEED + 1e-6
    if pairs:
        assert any("slow-motion replay" in w for w in tl.warnings)


# ---------------------------------------------------------------------- AI director safety layer
def _direct(shots, clips, duration=12.0):
    audio = make_audio(duration=40)
    mm = build_music_map(audio, 0.0, duration)
    _, alias = clip_facts(clips)
    plan = ReelDirectorPlan.model_validate({"style": "cinematic", "grade": "warm", "shots": shots})
    return plan_to_timeline(plan, alias, clips, mm, 0.0, duration, get_style("cinematic"), style_ids=STYLES, keep_style=True)


def test_the_ai_cannot_show_the_same_moment_twice():
    clips = [make_clip(f"id{i}", dur=10.0, sig_bin=i) for i in range(3)]
    same = {"clip": "c1", "source_start": 1.0, "source_end": 4.0, "duration": 3.0}
    d = _direct([same, same, same, {"clip": "c2", "source_start": 0, "source_end": 3, "duration": 3.0}], clips)
    assert overlaps(d.timeline.segments) == []
    assert any("already shown" in c for row in d.log for c in row["changes"])


def test_the_ai_cannot_use_a_bad_part():
    clips = [make_clip("id0", dur=12.0, windows=[win(0.0, 3.0), win(8.0, 12.0)]), make_clip("id1", dur=10.0, sig_bin=4)]
    d = _direct([{"clip": "c1", "source_start": 4.0, "source_end": 7.0, "duration": 3.0},  # inside the dark / shaky part
                 {"clip": "c2", "source_start": 0.0, "source_end": 3.0, "duration": 3.0},
                 {"clip": "c1", "source_start": 8.5, "source_end": 11.5, "duration": 3.0},
                 {"clip": "c2", "source_start": 4.0, "source_end": 7.0, "duration": 3.0}], clips)  # fmt: skip
    by = {c.clip_id: c for c in clips}
    assert all(inside_good_parts(s, by[s.clip_id]) for s in d.timeline.segments)
    assert overlaps(d.timeline.segments) == []
    assert "not a good part" in " ".join(d.log[0]["changes"])


def test_a_slow_motion_replay_the_ai_asked_for_is_allowed():
    clips = [make_clip(f"id{i}", dur=10.0, sig_bin=i) for i in range(2)]
    d = _direct([{"clip": "c1", "source_start": 2.0, "source_end": 5.0, "duration": 3.0},
                 {"clip": "c2", "source_start": 0.0, "source_end": 3.0, "duration": 3.0},
                 {"clip": "c1", "source_start": 2.0, "source_end": 3.8, "duration": 3.0, "speed": 0.6},  # a slow replay
                 {"clip": "c2", "source_start": 4.0, "source_end": 7.0, "duration": 3.0}], clips)  # fmt: skip
    replay = d.timeline.segments[2]
    assert replay.clip_id == "id0" and replay.speed == pytest.approx(0.6) and replay.source_start == pytest.approx(2.0)
    assert "slow-motion replay" in " ".join(d.log[2]["changes"])


# ---------------------------------------------------------------------- a plan too short for the Reel
def test_a_short_plan_is_filled_with_unused_footage_not_stretched():
    # each clip: a good part 0-2.5 s, a bad part, another good part 5-9 s; the AI only uses the first parts (12 s of
    # shots, at most 15 s of footage within reach) for a 24 s Reel
    clips = [make_clip(f"id{i}", dur=10.0, sig_bin=i, windows=[win(0.0, 2.5), win(5.0, 9.0)]) for i in range(6)]
    shots = [{"clip": f"c{i + 1}", "source_start": 0.2, "source_end": 2.2, "duration": 2.0} for i in range(6)]
    d = _direct(shots, clips, duration=24.0)
    segs = d.timeline.segments
    assert len(segs) > 6  # shots were added
    assert all(s.speed == pytest.approx(1.0) for s in segs)  # nothing slowed down to fill time
    assert overlaps(segs) == []
    by = {c.clip_id: c for c in clips}
    assert all(inside_good_parts(s, by[s.clip_id]) for s in segs)
    assert segs[0].clip_id == "id0" and segs[-1].clip_id == "id5"  # the hook and the ending stay where the AI put them
    assert any("unused footage" in f for f in d.fixes)
    assert d.problems and "unused good footage" in " ".join(d.problems)  # the AI's revision round gets concrete hints
    assert sum(s.timeline_end - s.timeline_start for s in segs) == pytest.approx(24.0, abs=1e-3)


def test_a_shot_may_run_across_the_analyzers_6s_seam():
    # the analyzer splits one continuous 12 s shot into two 6 s pieces; a 4 s shot from 4 s is still one good moment
    clips = [make_clip("id0", dur=12.0, windows=[win(0.0, 6.0), win(6.0, 12.0)]), make_clip("id1", dur=10.0, sig_bin=4)]
    d = _direct([{"clip": "c2", "source_start": 0.0, "source_end": 4.0, "duration": 4.0},
                 {"clip": "c1", "source_start": 4.0, "source_end": 8.0, "duration": 4.0},
                 {"clip": "c2", "source_start": 5.0, "source_end": 9.0, "duration": 4.0}], clips)  # fmt: skip
    seg = d.timeline.segments[1]
    assert seg.clip_id == "id0" and seg.source_start == pytest.approx(4.0) and seg.speed == pytest.approx(1.0)
    assert d.log[1]["changes"] == []


def test_the_last_shot_never_gets_more_time_than_its_footage():
    # the ending clip has 3 s of good footage left after the asked moment; the Reel is longer than the plan
    clips = [make_clip(f"id{i}", dur=12.0, sig_bin=i) for i in range(4)] + [make_clip("end", dur=5.0, sig_bin=9)]
    shots = [{"clip": f"c{i + 1}", "source_start": 1.0, "source_end": 3.0, "duration": 2.0} for i in range(4)]
    shots.append({"clip": "c5", "source_start": 2.0, "source_end": 4.5, "duration": 2.5, "purpose": "cta"})
    d = _direct(shots, clips, duration=16.0)
    last = d.timeline.segments[-1]
    assert last.clip_id == "end" and last.speed == pytest.approx(1.0)
    assert last.source_start == pytest.approx(2.0) and last.timeline_end - last.timeline_start <= 3.0 + 1e-3


def test_a_shot_that_runs_past_the_clips_end_starts_a_little_earlier_instead_of_being_cut_short():
    clips = [make_clip("short", dur=2.5, windows=[win(0.0, 2.5)]), make_clip("id1", dur=10.0, sig_bin=4)]
    d = _direct([{"clip": "c2", "source_start": 0.0, "source_end": 3.0, "duration": 3.0},
                 {"clip": "c1", "source_start": 1.0, "source_end": 2.9, "duration": 1.9},  # the clip ends at 2.5 s
                 {"clip": "c2", "source_start": 4.0, "source_end": 7.0, "duration": 3.0}], clips, duration=7.9)  # fmt: skip
    seg = d.timeline.segments[1]
    assert seg.clip_id == "short" and seg.speed == pytest.approx(1.0) and seg.source_end <= 2.5 + 1e-3
    assert seg.source_start < 1.0 and d.log[1]["changes"] == []
