"""Phase A: EDL operations (trim, split, move, delete, duplicate, replace, speed, captions, fit)."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter

from app.styles import get_style
from app.video.timeline import build_timeline
from app.video.timeline_ops import (
    AddCaption, Delete, DeleteCaption, Duplicate, EditError, FitDuration, Move, Operation, OpContext, Replace,
    SetCrop, SetEffect, SetLength, SetMusic, SetSpeed, SetTransition, Split, Trim, UpdateCaption, apply_operations,
    ensure_ids,
)  # fmt: skip
from app.models.timeline import CropSpec
from tests.test_timeline import make_audio, make_clip

CTX = OpContext(clip_durations={f"clip_{i}": 7.0 for i in range(5)},
                clip_names={f"clip_{i}": f"clip_{i}.mp4" for i in range(5)}, audio_duration=30.0)  # fmt: skip


@pytest.fixture
def tl():
    clips = [make_clip(f"clip_{i}", motion=0.2 + 0.15 * i, sig_bin=i * 4) for i in range(5)]
    return build_timeline(make_audio(), clips, 15, get_style("cinematic"), seed=1)


def contiguous(t):
    assert t.segments[0].timeline_start == 0
    for a, b in zip(t.segments, t.segments[1:]):
        assert a.timeline_end == pytest.approx(b.timeline_start, abs=1e-6)
    assert t.duration == pytest.approx(t.segments[-1].timeline_end, abs=1e-6)
    for s in t.segments:
        assert s.source_end - s.source_start == pytest.approx(s.length * s.speed, abs=0.01)
        assert 0 <= s.source_start and s.source_end <= 7.0 + 1e-6


def test_every_generated_shot_has_a_stable_unique_id(tl):
    ids = [s.id for s in tl.segments]
    assert len(set(ids)) == len(ids) and all(ids)


def test_split_keeps_source_continuity_and_total_duration(tl):
    s = tl.segments[1]
    at = s.timeline_start + s.length / 2
    out = apply_operations(tl, [Split(segment_id=s.id, at=at)], CTX)
    a, b = out.segments[1], out.segments[2]
    assert len(out.segments) == len(tl.segments) + 1
    assert a.source_end == pytest.approx(b.source_start, abs=0.01) and a.clip_id == b.clip_id
    assert a.source_start == pytest.approx(s.source_start, abs=0.01) and b.source_end == pytest.approx(s.source_end, abs=0.01)
    assert out.duration == pytest.approx(tl.duration, abs=0.01)
    assert b.transition_in.type == "cut" and a.id != b.id
    contiguous(out)


def test_split_too_close_to_an_edge_is_rejected(tl):
    s = tl.segments[0]
    with pytest.raises(EditError) as e:
        apply_operations(tl, [Split(segment_id=s.id, at=s.timeline_start + 0.05)], CTX)
    assert e.value.code == "SPLIT_OUT_OF_RANGE"


def test_delete_ripples_and_last_shot_is_protected(tl):
    victim = tl.segments[2]
    out = apply_operations(tl, [Delete(segment_id=victim.id)], CTX)
    assert victim.id not in [s.id for s in out.segments]
    assert out.duration == pytest.approx(tl.duration - victim.length, abs=0.01)
    contiguous(out)
    single = out
    while len(single.segments) > 1:
        single = apply_operations(single, [Delete(segment_id=single.segments[0].id)], CTX)
    with pytest.raises(EditError) as e:
        apply_operations(single, [Delete(segment_id=single.segments[0].id)], CTX)
    assert e.value.code == "LAST_SEGMENT"


def test_move_reorders_without_changing_total_duration(tl):
    first, last = tl.segments[0], tl.segments[-1]
    out = apply_operations(tl, [Move(segment_id=last.id, to_index=0)], CTX)
    assert out.segments[0].id == last.id and out.segments[-1].id != last.id
    assert out.duration == pytest.approx(tl.duration, abs=0.01)
    assert out.segments[0].transition_in.type == "cut"  # the new first shot cannot have an incoming transition
    contiguous(out)
    with pytest.raises(EditError):
        apply_operations(tl, [Move(segment_id=first.id, to_index=99)], CTX)


def test_duplicate_adds_an_independent_copy(tl):
    s = tl.segments[0]
    out = apply_operations(tl, [Duplicate(segment_id=s.id)], CTX)
    assert out.segments[1].id != s.id and out.segments[1].clip_id == s.clip_id
    assert out.duration == pytest.approx(tl.duration + s.length, abs=0.01)


def test_trim_changes_length_and_validates_range(tl):
    s = tl.segments[0]
    out = apply_operations(tl, [Trim(segment_id=s.id, source_start=s.source_start + 0.3)], CTX)
    assert out.segments[0].length == pytest.approx(s.length - 0.3, abs=0.02)
    assert out.duration < tl.duration
    contiguous(out)
    with pytest.raises(EditError) as e:
        apply_operations(tl, [Trim(segment_id=s.id, source_end=99.0)], CTX)
    assert e.value.code == "TRIM_OUT_OF_RANGE"
    with pytest.raises(EditError) as e:
        apply_operations(tl, [Trim(segment_id=s.id, source_start=s.source_start, source_end=s.source_start + 0.05)], CTX)
    assert e.value.code == "SEGMENT_TOO_SHORT"


def test_set_length_respects_available_footage(tl):
    s = tl.segments[0]
    out = apply_operations(tl, [SetLength(segment_id=s.id, length=1.0)], CTX)
    assert out.segments[0].length == pytest.approx(1.0, abs=0.01)
    with pytest.raises(EditError) as e:
        apply_operations(tl, [SetLength(segment_id=s.id, length=20.0)], CTX)
    assert e.value.code == "NOT_ENOUGH_FOOTAGE"


def test_speed_change_keeps_timeline_position_and_adapts_source(tl):
    s = tl.segments[1]
    out = apply_operations(tl, [SetSpeed(segment_id=s.id, speed=0.5)], CTX)
    n = out.segments[1]
    assert n.length == pytest.approx(s.length, abs=0.01) and n.speed == 0.5
    assert n.source_end - n.source_start == pytest.approx(s.length * 0.5, abs=0.02)
    fast = apply_operations(tl, [SetSpeed(segment_id=s.id, speed=2.0)], CTX).segments[1]
    assert fast.source_end <= 7.0 + 1e-6  # shifted back into the clip if needed
    with pytest.raises(EditError):
        apply_operations(tl, [SetSpeed(segment_id=s.id, speed=10)], CTX)
    contiguous(out)


def test_replace_swaps_clip_and_resets_framing(tl):
    s = tl.segments[0]
    other = "clip_4" if s.clip_id != "clip_4" else "clip_3"
    out = apply_operations(tl, [Replace(segment_id=s.id, clip_id=other, source_start=1.0)], CTX)
    n = out.segments[0]
    assert n.clip_id == other and n.video == f"{other}.mp4" and n.source_start == pytest.approx(1.0)
    assert n.length == pytest.approx(s.length, abs=0.01)
    with pytest.raises(EditError) as e:
        apply_operations(tl, [Replace(segment_id=s.id, clip_id="not-a-clip")], CTX)
    assert e.value.code == "CLIP_NOT_FOUND"


def test_transitions_are_validated_and_clamped(tl):
    a, b = tl.segments[0], tl.segments[1]
    out = apply_operations(tl, [SetTransition(segment_id=b.id, transition="dissolve", duration=99)], CTX)
    t = out.segments[1].transition_in
    assert t.type == "dissolve" and t.duration <= 0.45 * min(out.segments[0].length, out.segments[1].length) + 1e-6
    with pytest.raises(EditError) as e:
        apply_operations(tl, [SetTransition(segment_id=b.id, transition="sparkle")], CTX)
    assert e.value.code == "UNKNOWN_TRANSITION"
    with pytest.raises(EditError) as e:
        apply_operations(tl, [SetTransition(segment_id=a.id, transition="fade")], CTX)
    assert e.value.code == "FIRST_SEGMENT_TRANSITION"


def test_effect_and_crop_overrides(tl):
    s = tl.segments[0]
    out = apply_operations(tl, [SetEffect(segment_id=s.id, effect="punch"),
                                SetCrop(segment_id=s.id, crop=CropSpec(framing="fit"))], CTX)  # fmt: skip
    assert out.segments[0].effect == "punch" and out.segments[0].crop.framing == "fit"
    with pytest.raises(EditError):
        apply_operations(tl, [SetEffect(segment_id=s.id, effect="lens-flare")], CTX)


def test_music_controls_and_audio_window(tl):
    out = apply_operations(tl, [SetMusic(volume=0.6, fade_out=2.0, audio_start=29.0)], CTX)
    assert out.music_volume == 0.6 and out.music_fade_out == 2.0
    assert out.audio_start + out.duration <= 30.0 + 1e-6  # pulled back so the music window fits the song


def test_captions_add_edit_delete_and_never_overlap(tl):
    out = apply_operations(tl, [AddCaption(start=1.0, end=3.0, text="Hello big world"),
                                AddCaption(start=2.5, end=4.0, text="Second line")], CTX)  # fmt: skip
    c1, c2 = out.captions
    assert c1.end <= c2.start and [w.text for w in c1.words] == ["Hello", "big", "world"]
    edited = apply_operations(out, [UpdateCaption(caption_id=c1.id, text="Hi")], CTX)
    assert edited.captions[0].text == "Hi" and len(edited.captions[0].words) == 1
    gone = apply_operations(edited, [DeleteCaption(caption_id=c1.id)], CTX)
    assert len(gone.captions) == 1
    with pytest.raises(EditError) as e:
        apply_operations(gone, [DeleteCaption(caption_id="nope")], CTX)
    assert e.value.code == "CAPTION_NOT_FOUND"
    clamped = apply_operations(tl, [AddCaption(start=tl.duration - 0.5, end=tl.duration + 5, text="late")], CTX)
    assert clamped.captions[0].end <= clamped.duration


def test_captions_follow_shots_when_the_timeline_shortens(tl):
    out = apply_operations(tl, [AddCaption(start=tl.duration - 2, end=tl.duration - 0.5, text="end")], CTX)
    shorter = apply_operations(out, [Delete(segment_id=out.segments[0].id)], CTX)
    assert all(c.end <= shorter.duration for c in shorter.captions)


def test_fit_duration_shorter_longer_and_impossible(tl):
    short = apply_operations(tl, [FitDuration(target=10)], CTX)
    assert short.duration == pytest.approx(10, abs=0.05)
    assert all(s.length >= 0.25 for s in short.segments)
    contiguous(short)
    longer = apply_operations(short, [FitDuration(target=13)], CTX)
    assert longer.duration == pytest.approx(13, abs=0.05)
    tiny_ctx = OpContext(clip_durations={c: 1.0 for c in CTX.clip_durations}, audio_duration=30)
    with pytest.raises(EditError) as e:
        apply_operations(short, [FitDuration(target=60)], tiny_ctx)
    assert e.value.code == "NOT_ENOUGH_FOOTAGE"


def test_batches_are_atomic_and_never_mutate_the_input(tl):
    snapshot = tl.to_doc()
    s = tl.segments[0]
    with pytest.raises(EditError):
        apply_operations(tl, [SetEffect(segment_id=s.id, effect="punch"), Delete(segment_id="missing")], CTX)
    assert tl.to_doc() == snapshot
    apply_operations(tl, [Delete(segment_id=s.id)], CTX)
    assert tl.to_doc() == snapshot


def test_operations_parse_from_api_json():
    ops = TypeAdapter(list[Operation]).validate_python([
        {"type": "split", "segmentId": "a", "at": 1.5},
        {"type": "setTransition"[:0] + "set_transition", "segmentId": "b", "transition": "fade", "duration": 0.4},
        {"type": "set_music", "volume": 0.5},
        {"type": "fit_duration", "target": 15},
    ])  # fmt: skip
    assert [type(o).__name__ for o in ops] == ["Split", "SetTransition", "SetMusic", "FitDuration"]
    with pytest.raises(Exception):
        TypeAdapter(list[Operation]).validate_python([{"type": "rm -rf", "segmentId": "a"}])
    with pytest.raises(Exception):
        TypeAdapter(list[Operation]).validate_python([{"type": "set_music", "volume": 9}])


def test_ensure_ids_upgrades_old_timelines():
    doc = {"segments": [{"clipId": "a"}, {"clipId": "b", "id": "keep"}], "captions": [{}]}
    out = ensure_ids(doc)
    assert out["segments"][1]["id"] == "keep" and out["segments"][0]["id"] and out["captions"][0]["id"]
