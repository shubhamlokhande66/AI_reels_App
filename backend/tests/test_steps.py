"""Step-by-step Reels: clips keep the order the steps happened, each is shown once, cuts land on beats."""

from __future__ import annotations

import pytest

from app.styles import get_style
from app.video.steps import build_steps_timeline, order_clips, recording_key
from app.video.timeline import nearest_beat_error
from tests.test_timeline import make_audio, make_clip


def clip(name, dur):
    c = make_clip(name.replace(".mp4", ""), dur=dur)
    c.name = name
    return c


def test_file_names_reveal_the_recording_order():
    names = ["VID-20240101-WA0009.mp4", "VID-20240101-WA0002.mp4", "VID-20231231-WA0100.mp4"]
    keys = sorted(names, key=recording_key)
    assert keys == ["VID-20231231-WA0100.mp4", "VID-20240101-WA0002.mp4", "VID-20240101-WA0009.mp4"]
    assert recording_key("IMG_20240301_101500.mp4") < recording_key("IMG_20240301_101501.mp4")
    assert recording_key("IMG_0012.MOV") < recording_key("IMG_0110.MOV")
    assert recording_key("onion.mp4") is None
    wa = ["WhatsApp Video 2026-09-21 at 2.57.54 PM.mp4", "WhatsApp Video 2026-09-21 at 2.45.37 PM.mp4", "WhatsApp Video 2026-09-21 at 11.59.00 AM.mp4", "WhatsApp Video 2026-09-21 at 12.05.00 PM.mp4"]
    assert sorted(wa, key=recording_key) == [wa[2], wa[3], wa[1], wa[0]]  # 11:59 AM, 12:05 PM, 2:45 PM, 2:57 PM


def test_clips_are_reordered_only_when_every_name_shows_the_time():
    notes = []
    a, b = clip("IMG_0003.mp4", 4), clip("IMG_0001.mp4", 4)
    assert [c.name for c in order_clips([a, b], notes)] == ["IMG_0001.mp4", "IMG_0003.mp4"] and "file names" in notes[0]
    notes = []
    x, y = clip("chop.mp4", 4), clip("IMG_0001.mp4", 4)
    assert [c.name for c in order_clips([x, y], notes)] == ["chop.mp4", "IMG_0001.mp4"] and "order of your clip list" in notes[0]


def test_each_clip_appears_once_in_order_and_fills_the_reel():
    clips = [clip(f"IMG_{i:04d}.mp4", d) for i, d in enumerate([3, 4, 3, 5, 3, 4])]
    tl = build_steps_timeline(make_audio(duration=60), clips[::-1], 15, get_style("fast_trending"), seed=3)
    assert [s.video for s in tl.segments] == [c.name for c in clips]  # recorded order, whatever order they were given in
    assert tl.segments[0].timeline_start == 0 and abs(tl.segments[-1].timeline_end - tl.duration) < 1e-6
    assert all(abs(a.timeline_end - b.timeline_start) < 1e-6 for a, b in zip(tl.segments, tl.segments[1:]))
    assert all(s.length >= 0.7 - 1e-6 for s in tl.segments)


def test_the_finished_dish_last_gets_the_longest_look_and_the_end_of_its_clip():
    clips = [clip(f"IMG_{i:04d}.mp4", 4) for i in range(5)]
    tl = build_steps_timeline(make_audio(duration=60), clips, 20, get_style("fast_trending"))
    last, first = tl.segments[-1], tl.segments[0]
    assert last.length >= first.length
    assert abs(last.source_end - 4.0) < 1e-6  # the end of the clip: the plated dish, not its first second


def test_long_steps_are_sped_up_and_short_reels_do_not_pad():
    clips = [clip(f"IMG_{i:04d}.mp4", 12) for i in range(4)]
    tl = build_steps_timeline(make_audio(duration=60), clips, 10, get_style("fast_trending"))
    ff = [s for s in tl.segments[:-1] if s.speed > 1.05]
    assert ff and all(s.speed <= 2.0 + 1e-6 for s in tl.segments)
    assert all(s.source_end <= 12.0 + 1e-6 for s in tl.segments) and any("sped up" in n for n in tl.notes)
    # two short clips for a 30 s Reel: the Reel is as long as the footage, and says so
    short = build_steps_timeline(make_audio(duration=60), [clip("IMG_0001.mp4", 3), clip("IMG_0002.mp4", 3)], 30, get_style("fast_trending"))
    assert short.duration < 10 and any("that is all the footage" in n for n in short.notes)


def test_cuts_land_on_beats():
    audio = make_audio(duration=60)
    clips = [clip(f"IMG_{i:04d}.mp4", 6) for i in range(6)]
    tl = build_steps_timeline(audio, clips, 18, get_style("fast_trending"))
    assert nearest_beat_error(tl, audio) < 0.06


def test_many_steps_in_a_short_reel_stretch_the_reel_rather_than_flicker():
    clips = [clip(f"IMG_{i:04d}.mp4", 3) for i in range(30)]
    tl = build_steps_timeline(make_audio(duration=90), clips, 15, get_style("fast_trending"))
    assert len(tl.segments) == 30 and tl.duration >= 21 - 1e-6 and any("readable" in n for n in tl.notes)


def test_teaser_opens_with_the_end_of_the_last_clip_then_the_steps_follow_in_order():
    clips = [clip(f"IMG_{i:04d}.mp4", 5) for i in range(5)]
    audio = make_audio(duration=60)
    tl = build_steps_timeline(audio, clips, 20, get_style("fast_trending"), teaser=True)
    first, second = tl.segments[0], tl.segments[1]
    assert first.video == "IMG_0004.mp4" and abs(first.source_end - 5.0) < 1e-6  # the last moments of the last clip
    assert 0.8 <= first.length <= 1.7 and second.video == "IMG_0000.mp4"
    assert [s.video for s in tl.segments[1:]] == [c.name for c in clips]
    assert all(abs(a.timeline_end - b.timeline_start) < 1e-6 for a, b in zip(tl.segments, tl.segments[1:]))
    assert abs(tl.segments[-1].timeline_end - tl.duration) < 1e-6 and any("finished dish" in n for n in tl.notes)
    assert nearest_beat_error(tl, audio) < 0.06


def test_no_teaser_for_a_single_clip_and_none_by_default():
    assert len(build_steps_timeline(make_audio(duration=60), [clip("IMG_0001.mp4", 6)], 15, get_style("fast_trending"), teaser=True).segments) == 1
    tl = build_steps_timeline(make_audio(duration=60), [clip(f"IMG_{i:04d}.mp4", 5) for i in range(3)], 15, get_style("fast_trending"))
    assert len(tl.segments) == 3


def test_step_labels_count_the_steps_not_the_teaser_and_follow_the_language():
    clips = [clip(f"IMG_{i:04d}.mp4", 5) for i in range(4)]
    tl = build_steps_timeline(make_audio(duration=60), clips, 20, get_style("fast_trending"), teaser=True, step_labels=True)
    assert [c.text for c in tl.captions] == ["The result", "Step 1", "Step 2", "Step 3", "Done!"]
    assert tl.caption_style == "bold" and all(c.words for c in tl.captions)
    for cap, seg in zip(tl.captions, tl.segments):  # each label sits inside its own shot
        assert seg.timeline_start <= cap.start < cap.end <= seg.timeline_end
    hi = build_steps_timeline(make_audio(duration=60), clips, 20, get_style("fast_trending"), step_labels=True, language="hi")
    assert hi.captions[0].text == "स्टेप 1"
    assert build_steps_timeline(make_audio(duration=60), clips, 20, get_style("fast_trending")).captions == []


# ------------------------------------------------------------------ story from what the clips show
from app.ai.understanding import ClipSemantic  # noqa: E402
from app.director.story import detect_category, order_for_food  # noqa: E402


def seen(c, stage, **kw):
    c.semantic = ClipSemantic(clip_id=c.clip_id, scene="kitchen", stage=stage, category="food", **kw)
    return c


def test_clips_are_arranged_by_what_they_show_even_when_the_file_names_say_otherwise():
    a = seen(clip("IMG_0001.mp4", 4), "finished", hook_candidate=True, importance=0.9)  # recorded first, but it is the dish
    b = seen(clip("IMG_0002.mp4", 4), "preparation")
    c = seen(clip("IMG_0003.mp4", 4), "cooking")
    d = seen(clip("IMG_0004.mp4", 4), "ingredients")
    tl = build_steps_timeline(make_audio(duration=60), [a, b, c, d], 16, get_style("fast_trending"), teaser=True, step_labels=True)
    assert [s.video for s in tl.segments] == ["IMG_0001.mp4", "IMG_0004.mp4", "IMG_0002.mp4", "IMG_0003.mp4", "IMG_0001.mp4"]  # teaser, then the recipe, dish last
    assert [x.text for x in tl.captions] == ["The result", "Ingredients", "Step 1", "Step 2", "Done!"]
    assert any("by what they show" in n for n in tl.notes)


def test_no_result_teaser_when_no_clip_shows_the_finished_dish():
    clips = [seen(clip(f"IMG_{i:04d}.mp4", 4), st) for i, st in enumerate(["ingredients", "preparation", "cooking"])]
    tl = build_steps_timeline(make_audio(duration=60), clips, 12, get_style("fast_trending"), teaser=True, step_labels=True)
    assert len(tl.segments) == 3 and [x.text for x in tl.captions] == ["Ingredients", "Step 1", "Step 2"]  # the last step is a step, not "Done!"
    assert any("No clip shows the finished dish" in n for n in tl.notes)


def test_clips_the_model_could_not_place_stay_next_to_their_neighbour():
    ing, unknown, cook = seen(clip("IMG_0001.mp4", 4), "ingredients"), clip("IMG_0002.mp4", 4), seen(clip("IMG_0003.mp4", 4), "cooking")
    story = order_for_food([cook, ing, unknown])  # cooking, ingredients, ?  ->  ingredients, ? (after ingredients), cooking
    assert [x.name for x in story.clips] == ["IMG_0001.mp4", "IMG_0002.mp4", "IMG_0003.mp4"] and story.used_vision


def test_category_comes_from_what_the_clips_show_and_says_so_when_it_cannot_tell():
    food = detect_category([seen(clip("a.mp4", 3), "cooking").semantic])
    assert food.name == "food" and food.source == "vision"
    assert detect_category([None, None]).name == "other" and detect_category([None], "food").source == "style"


def test_manual_order_keeps_the_clips_exactly_as_given_no_filename_or_vision_reordering():
    a = seen(clip("IMG_0009.mp4", 4), "finished", hook_candidate=True, importance=0.9)  # recorded last, but listed first: kept there
    b = seen(clip("IMG_0001.mp4", 4), "ingredients")
    c = seen(clip("IMG_0005.mp4", 4), "cooking")
    tl = build_steps_timeline(make_audio(duration=60), [a, b, c], 15, get_style("fast_trending"), teaser=True, step_labels=True, order_mode="manual")
    # a teaser of the LAST clip in your list still opens the Reel (that toggle is independent of order); the steps after it are exactly your order
    assert [s.video for s in tl.segments] == ["IMG_0005.mp4", "IMG_0009.mp4", "IMG_0001.mp4", "IMG_0005.mp4"]
    assert any("order you arranged" in n for n in tl.notes)
    assert [x.text for x in tl.captions] == ["The result", "Step 1", "Ingredients", "Step 2"]  # the teaser clip is "cooking" here, not "finished", so it is not "Done!"

    no_teaser = build_steps_timeline(make_audio(duration=60), [a, b, c], 15, get_style("fast_trending"), teaser=False, step_labels=True, order_mode="manual")
    assert [s.video for s in no_teaser.segments] == ["IMG_0009.mp4", "IMG_0001.mp4", "IMG_0005.mp4"]  # exactly as given, nothing added


def test_auto_order_is_still_the_default():
    a = seen(clip("IMG_0009.mp4", 4), "finished", hook_candidate=True, importance=0.9)
    b = seen(clip("IMG_0001.mp4", 4), "ingredients")
    tl = build_steps_timeline(make_audio(duration=60), [a, b], 15, get_style("fast_trending"), teaser=True, step_labels=True)
    assert tl.segments[0].video == "IMG_0009.mp4"  # the finished-dish clip leads the teaser, as before


def test_step_boundary_snaps_onto_a_nearby_strong_accent():
    """Same real-world behaviour as the main editor: a step's cut point moves onto a genuine strong hit near it."""
    audio = make_audio(bpm=120, duration=30, loud_from=0, accents=[(3.58, 0.9)])  # 0.08s off the plain-grid boundary at 3.5s
    clips = [clip("IMG_0001.mp4", 4), clip("IMG_0002.mp4", 4)]
    tl = build_steps_timeline(audio, clips, 8, get_style("fast_trending"), audio_start=0.0)
    assert tl.segments[0].timeline_end == 3.58 and tl.segments[1].timeline_start == 3.58

    weak = build_steps_timeline(make_audio(bpm=120, duration=30, loud_from=0, accents=[(3.58, 0.3)]), clips, 8, get_style("fast_trending"), audio_start=0.0)
    assert weak.segments[0].timeline_end == 3.5  # too weak a hit to move the cut
