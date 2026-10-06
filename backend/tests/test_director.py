"""The Reel director: music map, quality control that repairs, and the plan document."""

from __future__ import annotations

import pytest

from app.director.music_map import build_music_map
from app.director.plan import build_reel_plan
from app.director.review import MIN_ENDING, review_timeline
from app.director.story import Category
from app.styles import get_style
from app.video.steps import build_steps_timeline
from app.video.timeline import build_timeline
from tests.test_timeline import make_audio, make_clip


def test_music_map_grades_beats_and_finds_drops_pauses_and_energy():
    audio = make_audio(bpm=120, duration=40, loud_from=15, drops=(15.0,), accents=[(1.5, 0.6), (2.5, 1.0), (15.0, 1.0)])
    mm = build_music_map(audio, 0.0, 30.0)
    lvl = {b.t: b.level for b in mm.beats}
    assert lvl[15.0] == 4  # a drop is a major hit
    assert lvl[4.0] == 3 and any(b.downbeat for b in mm.beats if b.t == 4.0)  # a downbeat (start of a bar) is strong
    assert lvl[2.5] == 3  # a hit as strong as a strong drum hit, off the bar line
    assert lvl[1.5] == 2  # a moderate hit is a normal beat
    assert lvl[0.5] == 1  # nothing happens on it: subtle
    assert mm.bars[:3] == [0.0, 2.0, 4.0] and mm.phrases[:2] == [0.0, 8.0]
    assert mm.energy_curve[0][2] == "low" and mm.energy_curve[-1][2] in ("high", "very_high")
    assert mm.level_at(15.02) == 4 and mm.level_at(15.25) == 1  # no beat nearby
    assert any("vocal" in n for n in mm.to_doc()["notDetected"])  # the limits are stated, not hidden


def test_quiet_gaps_are_reported_as_pauses():
    audio = make_audio(duration=20)
    audio.energy = [0.6] * 50 + [0.0] * 8 + [0.6] * (len(audio.energy) - 58)  # 0.8 s of near-silence at 5.0 s
    mm = build_music_map(audio, 0.0, 20.0)
    assert len(mm.pauses) == 1 and 4.9 <= mm.pauses[0][0] <= 5.1 and mm.pauses[0][1] - mm.pauses[0][0] >= 0.7


def _timeline(n_clips=4, dur=15, seed=1):
    audio = make_audio(duration=60)
    clips = [make_clip(f"c{i}", dur=8) for i in range(n_clips)]
    return audio, clips, build_timeline(audio, clips, dur, get_style("fast_trending"), seed=seed)


def test_review_repairs_a_flicker_a_cut_off_ending_and_a_repeat():
    audio, clips, tl = _timeline()
    mm = build_music_map(audio, tl.audio_start, tl.duration)
    # break the timeline on purpose
    tl.segments[2].timeline_end = tl.segments[2].timeline_start + 0.1  # a 0.1 s flicker...
    tl.segments[3].timeline_start = tl.segments[2].timeline_end        # ...the next shot takes over
    last = tl.segments[-1]
    prev = tl.segments[-2]
    steal = last.length - 0.4  # make the ending 0.4 s and give the time to the shot before
    last.timeline_start += steal
    prev.timeline_end += steal
    checks = review_timeline(tl, clips, mm)
    by = {c.name: c for c in checks}
    assert by["No flicker shots (each at least 0.25 s)"].ok and by["No flicker shots (each at least 0.25 s)"].fixed
    assert all(s.length >= 0.25 - 1e-6 for s in tl.segments)
    assert by["The ending is a real shot, not a cut-off"].ok and tl.segments[-1].length >= MIN_ENDING - 1e-6
    assert abs(tl.segments[0].timeline_start) < 1e-9 and abs(tl.segments[-1].timeline_end - tl.duration) < 1e-6
    assert all(abs(a.timeline_end - b.timeline_start) < 1e-6 for a, b in zip(tl.segments, tl.segments[1:]))


def test_review_moves_a_duplicate_shot_to_unused_footage():
    audio, clips, tl = _timeline(n_clips=2, dur=10)
    mm = build_music_map(audio, tl.audio_start, tl.duration)
    a = tl.segments[0]
    b = next(s for s in tl.segments[2:] if s.clip_id == a.clip_id)
    b.source_start, b.source_end = a.source_start, a.source_start + (b.source_end - b.source_start)  # the same footage again
    checks = {c.name: c for c in review_timeline(tl, clips, mm)}
    c = checks["No accidental duplicate shots"]
    assert c.fixed and c.ok and b.source_start != a.source_start


def test_review_keeps_the_food_sequence_and_does_not_flag_the_teaser_as_a_duplicate():
    audio = make_audio(duration=60)
    from tests.test_steps import clip
    clips = [clip(f"IMG_{i:04d}.mp4", 5) for i in range(5)]
    tl = build_steps_timeline(audio, clips, 20, get_style("fast_trending"), teaser=True, step_labels=True)
    mm = build_music_map(audio, tl.audio_start, tl.duration)
    checks = {c.name: c for c in review_timeline(tl, clips, mm, steps_order=[c.clip_id for c in clips], teaser_first=True)}
    assert checks["The sequence of steps is preserved"].ok and checks["No accidental duplicate shots"].ok
    assert checks["Cuts land on the beat or a strong accent"].ok and checks["Text stays inside the Reel and its safe area"].ok


def test_plan_document_lists_every_shot_with_its_music_event_and_is_honest_about_unknowns():
    audio = make_audio(duration=60)
    from tests.test_steps import clip
    clips = [clip(f"IMG_{i:04d}.mp4", 5) for i in range(5)]
    tl = build_steps_timeline(audio, clips, 20, get_style("fast_trending"), teaser=True, step_labels=True)
    mm = build_music_map(audio, tl.audio_start, tl.duration)
    checks = review_timeline(tl, clips, mm, steps_order=[c.clip_id for c in clips], teaser_first=True)
    plan = build_reel_plan(tl, clips, mm, Category(), checks, steps=True, teaser=True)
    assert plan["format"] == "1080x1920" and plan["duration"] == tl.duration
    assert len(plan["shots"]) == len(tl.segments) and plan["hook"]["kind"] == "finished-result teaser"
    s0 = plan["shots"][0]
    assert s0["purpose"].startswith("hook") and s0["subject"] == "not analysed" and s0["beatLevel"] in (1, 2, 3, 4)
    assert s0["musicEvent"] and plan["ending"]["asset"] == tl.segments[-1].video
    assert plan["category"]["name"] == "other" and any("vocal" in x for x in plan["limits"])
    assert {"bpm", "beats", "bars", "phrases", "drops", "pauses", "energyCurve"} <= set(plan["music"])
