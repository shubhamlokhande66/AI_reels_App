"""Phase 5: timeline generation, clip selection, duration and beat-sync."""

from __future__ import annotations

import random

import pytest

from app.models.analysis import AudioAnalysis, ClipAnalysis, Section, UsableWindow, VideoMetadata
from app.styles import get_style, list_styles
from app.video.timeline import (
    ClipInput,
    assign_transitions,
    build_timeline,
    choose_music_window,
    nearest_beat_error,
    plan_slots,
    target_motion,
)


def make_audio(bpm=120.0, duration=30.0, loud_from=15.0, drops=(15.0,), accents=()):
    period = 60 / bpm
    beats = [round(i * period, 3) for i in range(int(duration / period))]
    hop = 0.1
    energy = [0.3 if i * hop < loud_from else 0.9 for i in range(int(duration / hop))]
    return AudioAnalysis(
        bpm=bpm, duration=duration, beats=beats, beat_confidence=0.95,
        strong_beats=beats[::4], onsets=beats,
        high_energy_sections=[Section(start=loud_from, end=duration)],
        drops=list(drops), energy_hop=hop, energy=energy,
        accents=[t for t, _ in accents], accent_strengths=[v for _, v in accents], analysis_version=3,
    )  # fmt: skip


def make_clip(cid, dur=7.0, motion=0.5, quality=0.8, orient="landscape", windows=None, sig_bin=0):
    w, h = (1920, 1080) if orient == "landscape" else (1080, 1920)
    sig = [0.0] * 24
    sig[sig_bin] = 1.0
    if windows is None:
        windows = [
            UsableWindow(start=0.0, end=dur, quality=quality, motion=motion, brightness=0.5, sharpness=0.8,
                         signature=sig, motion_curve=[motion] * int(dur / 0.25), curve_dt=0.25)
        ]
    meta = VideoMetadata(duration=dur, width=w, height=h, fps=30, orientation=orient)
    a = ClipAnalysis(clip_id=cid, metadata=meta, quality_score=quality, motion_score=motion,
                     brightness_score=0.9, sharpness_score=0.8, windows=windows, usable=True)
    return ClipInput(cid, f"{cid}.mp4", a)


@pytest.fixture
def five_clips():
    return [make_clip(f"clip_{i}", motion=0.15 + 0.17 * i, sig_bin=i * 4) for i in range(5)]


# ------------------------------------------------------------------ duration / structure
@pytest.mark.parametrize("style_id", [s.id for s in list_styles()])
@pytest.mark.parametrize("duration", [15, 30])
def test_duration_is_exact_and_contiguous(five_clips, style_id, duration):
    audio = make_audio(duration=40)
    tl = build_timeline(audio, five_clips, duration, get_style(style_id), seed=1)
    assert tl.duration == duration
    assert tl.segments[0].timeline_start == 0
    assert tl.segments[-1].timeline_end == duration
    for a, b in zip(tl.segments, tl.segments[1:]):
        assert a.timeline_end == pytest.approx(b.timeline_start, abs=1e-6)
    assert tl.total_segment_duration == pytest.approx(duration, abs=1e-3)


def test_source_span_matches_speed(five_clips):
    tl = build_timeline(make_audio(), five_clips, 15, get_style("luxury"), seed=3)
    for s in tl.segments:
        length = s.timeline_end - s.timeline_start
        assert s.source_end - s.source_start == pytest.approx(length * s.speed, abs=0.01)
        assert s.source_start >= 0 and s.source_end <= 7.01


def test_cuts_land_on_beats(five_clips):
    audio = make_audio()
    tl = build_timeline(audio, five_clips, 15, get_style("fast_trending"), seed=0)
    assert len(tl.segments) >= 8
    assert nearest_beat_error(tl, audio) < 0.02


def test_fast_style_cuts_more_than_cinematic(five_clips):
    audio = make_audio()
    fast = build_timeline(audio, five_clips, 15, get_style("fast_trending"))
    cine = build_timeline(audio, five_clips, 15, get_style("cinematic"))
    assert len(fast.segments) > 2 * len(cine.segments)
    assert min(s.timeline_end - s.timeline_start for s in cine.segments) >= 1.0


def test_pace_follows_energy(five_clips):
    audio = make_audio(loud_from=15)  # quiet 0-15, loud 15-30
    tl = build_timeline(audio, five_clips, 30, get_style("fast_trending"))
    quiet = [s for s in tl.segments if s.timeline_start < 14]
    loud = [s for s in tl.segments if s.timeline_start >= 16]
    avg = lambda ss: sum(s.timeline_end - s.timeline_start for s in ss) / len(ss)
    assert avg(loud) < avg(quiet)


# ------------------------------------------------------------------ clip selection
def test_every_clip_is_used_and_no_immediate_repeat(five_clips):
    tl = build_timeline(make_audio(), five_clips, 15, get_style("fast_trending"), seed=2)
    assert {s.clip_id for s in tl.segments} == {c.clip_id for c in five_clips}
    for a, b in zip(tl.segments, tl.segments[1:]):
        assert a.clip_id != b.clip_id


def test_source_ranges_not_reused_when_footage_is_plentiful(five_clips):
    tl = build_timeline(make_audio(), five_clips, 15, get_style("fast_trending"), seed=5)
    by_clip: dict[str, list] = {}
    for s in tl.segments:
        by_clip.setdefault(s.clip_id, []).append((s.source_start, s.source_end))
    for ranges in by_clip.values():
        ranges.sort()
        for (a0, a1), (b0, b1) in zip(ranges, ranges[1:]):
            assert b0 >= a1 - 0.05, "same footage used twice"
    assert not tl.warnings


def test_high_quality_clips_preferred():
    good = make_clip("good", quality=0.95, sig_bin=1)
    bad = make_clip("bad", quality=0.15, sig_bin=9)
    tl = build_timeline(make_audio(), [good, bad], 10, get_style("cinematic"), seed=0)
    dur = {c: sum(s.timeline_end - s.timeline_start for s in tl.segments if s.clip_id == c) for c in ("good", "bad")}
    assert dur["good"] > dur["bad"]


def test_motion_matches_energy():
    calm = [make_clip(f"calm{i}", motion=0.05, sig_bin=i * 2) for i in range(3)]
    wild = [make_clip(f"wild{i}", motion=0.95, sig_bin=12 + i * 2) for i in range(3)]
    audio = make_audio(loud_from=15)
    tl = build_timeline(audio, calm + wild, 30, get_style("fast_trending"), seed=0)
    loud = [s for s in tl.segments if s.timeline_start >= 16]
    quiet = [s for s in tl.segments if s.timeline_start < 14]
    frac = lambda ss: sum(s.clip_id.startswith("wild") for s in ss) / len(ss)
    # 30 s of fast cuts needs almost all 42 s of footage, so preference cannot be absolute
    assert frac(loud) - frac(quiet) >= 0.15


def test_unusable_clips_are_skipped_unless_needed(five_clips):
    five_clips[0].analysis.usable = False
    tl = build_timeline(make_audio(), five_clips, 15, get_style("fast_trending"), seed=0)
    assert "clip_0" not in {s.clip_id for s in tl.segments}
    for c in five_clips:
        c.analysis.usable = False
    tl = build_timeline(make_audio(), five_clips, 15, get_style("fast_trending"), seed=0)
    assert tl.segments and any("quality" in w for w in tl.warnings)


def test_visual_diversity_prefers_different_looking_neighbours():
    a = make_clip("a", sig_bin=0)
    b = make_clip("b", sig_bin=0)  # same look as a
    c = make_clip("c", sig_bin=12)  # different
    tl = build_timeline(make_audio(), [a, b, c], 10, get_style("fast_trending"), seed=0)
    pairs = [(x.clip_id, y.clip_id) for x, y in zip(tl.segments, tl.segments[1:])]
    same_look = sum(1 for p in pairs if set(p) == {"a", "b"})
    assert same_look <= len(pairs) // 2


def test_reuse_when_footage_is_short_warns():
    tiny = [make_clip("only", dur=3.0)]
    tl = build_timeline(make_audio(), tiny, 15, get_style("fast_trending"), seed=0)
    assert tl.duration == 15 and len(tl.segments) > 3
    assert any("repeat" in w or "footage" in w for w in tl.warnings)


def test_landscape_preferred_by_travel():
    land = make_clip("land", orient="landscape", sig_bin=1)
    port = make_clip("port", orient="portrait", sig_bin=9)
    tl = build_timeline(make_audio(), [land, port], 15, get_style("travel"), seed=0)
    assert tl.segments[0].clip_id == "land"  # establishing shot


def test_seed_determinism_and_variation(five_clips):
    audio = make_audio()
    st = get_style("fast_trending")
    t1 = build_timeline(audio, five_clips, 15, st, seed=7)
    t2 = build_timeline(audio, five_clips, 15, st, seed=7)
    t3 = build_timeline(audio, five_clips, 15, st, seed=8)
    assert t1.to_doc() == t2.to_doc()
    assert t1.to_doc() != t3.to_doc()


def test_order_hint_biases_selection():
    clips = [make_clip(f"clip_{i}", motion=0.4, sig_bin=i * 4) for i in range(5)]
    hint = {"clip_4": 0.0, "clip_0": 1.0}
    tl = build_timeline(make_audio(), clips, 15, get_style("cinematic"), seed=0, order_hint=hint)
    assert tl.segments[0].clip_id == "clip_4"
    assert tl.segments[-1].clip_id == "clip_0"


# ------------------------------------------------------------------ music window
def test_music_window_picks_energetic_beat_aligned_stretch():
    audio = make_audio(duration=60, loud_from=30, drops=(30.0,))
    start, eff = choose_music_window(audio, 15)
    assert eff == 15 and start >= 30 - 15 * 0.4 - 1
    assert start in audio.beats


def test_short_song_shortens_reel_with_warning(five_clips):
    audio = make_audio(duration=9.0, loud_from=4)
    tl = build_timeline(audio, five_clips, 15, get_style("fast_trending"))
    assert tl.duration <= 9 and tl.warnings
    assert tl.segments[-1].timeline_end == tl.duration


def test_sparse_beats_fall_back_to_tempo_grid(five_clips):
    audio = make_audio()
    audio.beats = [0.0, 10.0]
    slots = plan_slots(audio, 0.0, 15, get_style("fast_trending"))
    assert len(slots) > 5 and slots[-1].end == 15


# ------------------------------------------------------------------ transitions / effects
def test_transitions_not_overused_and_valid(five_clips):
    audio = make_audio()
    for style in list_styles():
        tl = build_timeline(audio, five_clips, 30, style, seed=4)
        non_cut = [s for s in tl.segments[1:] if s.transition_in.type != "cut"]
        assert len(non_cut) <= style.max_transition_ratio * max(len(tl.segments) - 1, 1) + 1
        assert tl.segments[0].transition_in.type == "cut"
        for s in non_cut:
            assert 0.05 < s.transition_in.duration <= style.transition_duration + 1e-6
            assert s.transition_in.duration <= 0.5 * (s.timeline_end - s.timeline_start)
        types = [s.transition_in.type for s in tl.segments[1:]]
        assert not any(a == b != "cut" for a, b in zip(types, types[1:]))  # never the same one twice


def test_fast_style_uses_mostly_cuts(five_clips):
    tl = build_timeline(make_audio(), five_clips, 30, get_style("fast_trending"), seed=1)
    cuts = sum(s.transition_in.type == "cut" for s in tl.segments)
    assert cuts / len(tl.segments) > 0.5


def test_luxury_slow_motion_and_reveal(five_clips):
    tl = build_timeline(make_audio(), five_clips, 15, get_style("luxury"), seed=1)
    assert tl.segments[-1].speed < 1.0  # reveal
    assert all(s.effect in ("zoom_in", "zoom_out") for s in tl.segments)


def test_target_motion_monotonic():
    assert target_motion(1.0, 0.9) > target_motion(0.0, 0.9)
    assert target_motion(1.0, -0.5) < 0.4


def test_timeline_json_shape(five_clips):
    doc = build_timeline(make_audio(), five_clips, 15, get_style("fast_trending")).to_doc()
    seg = doc["segments"][0]
    for key in ("video", "sourceStart", "sourceEnd", "timelineStart", "timelineEnd"):
        assert key in seg
    assert doc["duration"] == 15


# ------------------------------------------------------------------ the user picks which part of the song
def test_chosen_part_of_the_song_is_used_exactly():
    audio = make_audio(duration=200, loud_from=150, drops=(150.0,))
    auto, _ = choose_music_window(audio, 60)
    assert auto >= 90  # left alone, the app prefers the loud stretch
    warnings: list[str] = []
    start, eff = choose_music_window(audio, 60, warnings, start=12.5)
    assert (start, eff) == (12.5, 60.0) and warnings == []  # the user's choice wins, to the millisecond
    assert choose_music_window(audio, 60, None, start=0.0) == (0.0, 60.0)


def test_chosen_part_is_kept_inside_the_song_and_the_user_is_told():
    audio = make_audio(duration=100)
    warnings: list[str] = []
    start, eff = choose_music_window(audio, 60, warnings, start=70)  # 70 + 60 would run past the end
    assert start == pytest.approx(39.95, abs=0.01) and eff == 60
    assert "starts at 70.0s" in warnings[0] and "40.0s" in warnings[0]
    assert choose_music_window(audio, 60, [], start=-5)[0] == 0.0
    short = make_audio(duration=40)
    w2: list[str] = []
    assert choose_music_window(short, 60, w2, start=10) == (0.0, 39.0) and "shortened" in w2[0]  # a short song still shortens the Reel


def test_build_timeline_uses_the_chosen_start_and_long_lengths():
    audio = make_audio(duration=400, loud_from=300, drops=())
    clips = [make_clip(f"c{i}", dur=20, sig_bin=i * 6) for i in range(4)]
    tl = build_timeline(audio, clips, 300, get_style("cinematic"), seed=1, audio_start=45.0)
    assert tl.audio_start == 45.0 and tl.duration == 300  # a five minute Reel
    assert tl.segments[-1].timeline_end == pytest.approx(300, abs=0.05)
    auto = build_timeline(audio, clips, 300, get_style("cinematic"), seed=1)
    assert auto.audio_start != 45.0


# ------------------------------------------------------------------ the picture answers strong hits in the music
def _shot(start, end, src=5.0, speed=1.0, effect="zoom_in", trans=("dissolve", 0.3)):
    from app.models.timeline import Segment, Transition

    return Segment(clip_id="c", video="c.mp4", source_start=src, source_end=src + (end - start) * speed, timeline_start=start, timeline_end=end,
                   speed=speed, effect=effect, transition_in=Transition(type=trans[0], duration=trans[1]))  # fmt: skip


def test_a_strong_hit_inside_a_long_shot_splits_it_with_a_punch_and_the_footage_carries_on():
    from app.video.timeline import add_accent_hits

    # the real case: a 2.16 s shot (29.41-31.57) with hits at 30.76 and 31.04, the second one stronger
    audio = make_audio(duration=60, accents=[(30.76, 0.63), (31.04, 0.70)])
    segs = [_shot(29.41, 31.57)]
    assert add_accent_hits(segs, audio, 0.0) == 1  # the two hits are 0.28 s apart: only the stronger one is answered
    a, b = segs
    assert (a.timeline_start, b.timeline_end) == (29.41, 31.57)
    assert a.timeline_end == b.timeline_start == pytest.approx(31.04, abs=1 / 24)  # on the hit, rounded to a video frame
    assert a.source_end == b.source_start == pytest.approx(5.0 + (a.timeline_end - 29.41), abs=0.001)  # seamless: no repeat, nothing skipped
    assert (a.source_start, b.source_end) == (5.0, pytest.approx(5.0 + 2.16, abs=0.001))
    assert b.effect == "punch" and b.transition_in.type == "cut" and b.transition_in.duration == 0.0
    assert a.effect == "zoom_in" and a.transition_in.type == "dissolve"  # the shot's own entrance is untouched


def test_accent_splitting_keeps_the_edit_contiguous_and_the_same_length():
    from app.video.timeline import add_accent_hits

    audio = make_audio(duration=60, accents=[(2.4, 0.9), (4.4, 0.8), (4.9, 0.6), (9.0, 0.95)])
    segs = [_shot(0, 3.0, src=1), _shot(3.0, 6.2, src=1), _shot(6.2, 8.0, src=1), _shot(8.0, 12.0, src=1)]
    n = add_accent_hits(segs, audio, 0.0)
    assert n == 3 and len(segs) == 7
    assert segs[0].timeline_start == 0 and segs[-1].timeline_end == 12.0
    for prev, nxt in zip(segs, segs[1:]):
        assert nxt.timeline_start == prev.timeline_end  # no gaps, no overlaps
    for sg in segs:
        assert sg.source_end - sg.source_start == pytest.approx((sg.timeline_end - sg.timeline_start) * sg.speed, abs=0.002)  # every piece plays at its speed


def test_hits_that_should_not_cut_do_not():
    from app.video.timeline import add_accent_hits

    audio = make_audio(duration=60, accents=[(1.0, 0.9), (0.2, 0.9), (2.9, 0.9), (5.0, 0.4), (7.0, 0.9), (9.5, 0.9)])
    segs = [
        _shot(0, 3.0),                  # hits at 0.2 / 2.9 are too close to the edges, 1.0 is fine -> answered (control)
        _shot(3.0, 6.0),                # 5.0 is only 0.4 strong: ignored
        _shot(6.0, 7.2, src=1),         # too short a shot
        _shot(7.2, 10.2, speed=0.5),    # slow motion: never jolted
    ]
    assert add_accent_hits(segs, audio, 0.0) == 1
    assert [round(x.timeline_start, 2) for x in segs] == [0, 1.0, 3.0, 6.0, 7.2]
    # the closing "reveal" shot is left alone
    last = [_shot(8.0, 11.0)]
    assert add_accent_hits(last, make_audio(duration=60, accents=[(9.5, 0.9)]), 0.0, closing_reveal=True) == 0
    assert add_accent_hits(last, make_audio(duration=60), 0.0) == 0  # a song without analysed accents changes nothing


def test_accents_are_read_relative_to_the_chosen_part_of_the_song():
    from app.video.timeline import add_accent_hits

    audio = make_audio(duration=100, accents=[(50.0 + 1.5, 0.9)])  # song time
    segs = [_shot(0, 3.0)]
    assert add_accent_hits(segs, audio, 50.0) == 1 and segs[1].timeline_start == 1.5  # the Reel starts at 50 s of the song


def test_only_the_energetic_styles_answer_hits():
    from app.styles import get_style

    assert [get_style(s).accent_hits for s in ("fast_trending", "food", "travel")] == [True, True, True]
    assert [get_style(s).accent_hits for s in ("cinematic", "luxury", "minimal", "storytelling")] == [False] * 4


def test_build_timeline_answers_hits_for_energetic_styles_only_and_stays_deterministic():
    clips = [make_clip(f"c{i}", dur=20, sig_bin=i * 6) for i in range(4)]
    beats_only = make_audio(duration=40, loud_from=0, drops=())
    hits = [(t + 0.3, 0.9) for t in range(1, 39, 2)]  # a strong hit every 2 s, between beats
    audio = make_audio(duration=40, loud_from=0, drops=(), accents=hits)
    calm = build_timeline(audio, clips, 20, get_style("cinematic"), seed=4)
    assert len(calm.segments) == len(build_timeline(beats_only, clips, 20, get_style("cinematic"), seed=4).segments)  # cinematic: untouched
    steady = get_style("fast_trending").with_overrides(cut_beats_high=4, cut_beats_low=4)  # 2 s shots: long enough to answer a hit inside
    lively = build_timeline(audio, clips, 20, steady, seed=4)
    plain = build_timeline(beats_only, clips, 20, steady, seed=4)
    assert len(lively.segments) > len(plain.segments)
    assert lively.duration == plain.duration == 20 and lively.segments[-1].timeline_end == pytest.approx(20, abs=0.05)
    assert any("strong hits in the music" in n for n in lively.notes)
    assert sum(s.effect == "punch" for s in lively.segments) > sum(s.effect == "punch" for s in plain.segments)
    again = build_timeline(audio, clips, 20, steady, seed=4)
    assert [s.to_doc() for s in again.segments] == [s.to_doc() for s in lively.segments]  # same seed, same edit


def test_plan_slots_snaps_a_cut_onto_a_nearby_strong_accent_not_just_the_beat_grid():
    """Real Instagram Reels (measured directly): cuts sit within ~0.15s of a strong accent far more reliably than of the
    plain beat grid. A cut planned for a grid beat should move onto a strong accent just off that beat, the way editors do it."""
    audio = make_audio(bpm=120, duration=20, accents=[(4.08, 0.9)])  # 0.08s off the beat at 4.0s: exactly what we measured
    slots = plan_slots(audio, 0.0, 20.0, get_style("fast_trending"))
    cuts = sorted({round(s.start, 3) for s in slots} | {round(s.end, 3) for s in slots})
    assert any(abs(c - 4.08) < 1e-6 for c in cuts)  # the cut moved onto the real hit
    assert not any(abs(c - 4.0) < 1e-6 for c in cuts)  # not left sitting on the bare grid time


def test_plan_slots_ignores_a_weak_or_distant_accent():
    audio = make_audio(bpm=120, duration=20, accents=[(4.35, 0.9), (8.05, 0.3)])  # too far / too weak
    slots = plan_slots(audio, 0.0, 20.0, get_style("fast_trending"))
    cuts = {round(s.start, 3) for s in slots} | {round(s.end, 3) for s in slots}
    assert not any(abs(c - 4.35) < 1e-6 for c in cuts) and not any(abs(c - 8.05) < 1e-6 for c in cuts)
