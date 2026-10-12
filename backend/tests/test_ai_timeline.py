"""Step 2: the AI's timeline (director/ai_timeline.py). A scripted provider stands in for the AI: nothing is sent."""

from __future__ import annotations

import json

import pytest

from app.ai.provider import AIProvider
from app.ai.types import AIResult
from app.director import ai_timeline as at
from tests.test_timeline import make_clip


def _doc(duration=12.0, bpm=120.0):
    """A song analysis, schema 1.0: a beat every 0.5 s (a bar every 4), a drop at 4.0 s, a roll 3.25-3.75 s."""
    p = 60 / bpm
    beats = [{"time_sec": round(k * p, 3), "strength": 0.8, "downbeat": k % 4 == 0, "beat_in_bar": k % 4 + 1} for k in range(int(duration / p))]
    events = [{"type": "STRONG_BEAT", "time_sec": b["time_sec"], "start_sec": None, "end_sec": None, "strength": 1.0, "confidence": 0.9}
              for b in beats[::4]]  # fmt: skip
    events += [{"type": "MUSIC_DROP", "time_sec": 4.0, "start_sec": None, "end_sec": None, "strength": 0.9, "confidence": 0.8},
               {"type": "ROLL", "time_sec": None, "start_sec": 3.25, "end_sec": 3.75, "strength": 0.7, "confidence": 0.8}]
    return {"schema_version": "1.0", "status": "completed",
            "tempo": {"bpm": bpm, "alternative_bpm": bpm / 2, "beat_interval_sec": p, "sections": [{"start_sec": 0, "end_sec": duration, "bpm": bpm, "confidence": 0.9}]},
            "beats": beats, "energy_curve": {"sample_interval_sec": 0.25, "values": [0.3] * 16 + [0.9] * int(duration * 4 - 16)},
            "sections": [{"type": "INTRO", "start_sec": 0.0, "end_sec": 4.0, "energy_level": "LOW_ENERGY", "energy": 0.3, "confidence": 0.8},
                         {"type": "DROP", "start_sec": 4.0, "end_sec": duration, "energy_level": "HIGH_ENERGY", "energy": 0.9, "confidence": 0.8}],
            "candidate_events": sorted(events, key=lambda e: e["time_sec"] if e["time_sec"] is not None else e["start_sec"]), "errors": []}  # fmt: skip


class Editor(AIProvider):
    name, model = "openai", "editor-test"

    def __init__(self, answer):
        self.answer, self.requests = answer, []

    def generate(self, req):
        self.requests.append(req)
        text = json.dumps(self.answer)
        return AIResult(text=text, provider=self.name, model=self.model, parsed=json.loads(text))

    def health(self):
        return {"available": True, "model": self.model, "detail": "ready"}


def _shot(a, b, clip, src, effects=(), tr=("HARD_CUT", 0), speed=1.0):
    return {"timeline_start_sec": a, "timeline_end_sec": b, "clip_id": clip, "source_start_sec": src, "source_end_sec": src + (b - a) * speed,
            "speed": speed, "effects": list(effects), "transition_out": None if tr is None else {"type": tr[0], "duration_sec": tr[1]}}  # fmt: skip


@pytest.fixture
def clips():
    return [make_clip(f"id{i}", dur=8.0) for i in range(3)]


def test_a_good_answer_comes_back_in_the_agreed_shape(clips):
    good = {"timeline": [
        _shot(0.0, 2.0, "clip_01", 1.0),
        _shot(2.0, 4.0, "clip_02", 0.5, effects=[{"type": "ZOOM_IN", "start_offset_sec": 0, "duration_sec": 0.2}], tr=("FLASH", 0.15)),
        _shot(4.0, 8.0, "clip_03", 2.0, effects=[{"type": "CRASH_ZOOM", "start_offset_sec": 0, "duration_sec": 0.4}]),
        _shot(8.0, 12.0, "clip_01", 4.0, tr=None),
    ]}  # fmt: skip
    ai = Editor(good)
    out = at.plan_timeline(_doc(), clips, start=0.0, duration=12.0, min_clip=0.4, provider=ai)
    tl = out["timeline"]
    assert [s["timeline_start_sec"] for s in tl] == [0.0, 2.0, 4.0, 8.0] and tl[-1]["timeline_end_sec"] == 12.0
    assert tl[1]["transition_out"] == {"type": "FLASH", "duration_sec": 0.15} and tl[-1]["transition_out"] is None
    assert tl[1]["effects"] == [{"type": "ZOOM_IN", "start_offset_sec": 0.0, "duration_sec": 0.2}]
    assert out["notes"] == [] and out["provider"] == "openai"
    sent = json.loads(ai.requests[0].user)
    assert sent["music"]["reel_seconds"] == 12.0 and {e["type"] for e in sent["music"]["events"]} >= {"MUSIC_DROP", "ROLL"}
    assert [c["clip"] for c in sent["clips"]] == ["clip_01", "clip_02", "clip_03"]  # readable ids, never the internal ones
    assert ai.requests[0].temperature == 0.0


def test_a_bad_answer_is_made_playable_and_says_what_changed(clips):
    bad = {"timeline": [
        _shot(0.0, 1.93, "clip_01", 1.0),  # cut 70 ms off the beat at 2.0
        _shot(1.93, 2.1, "clip_02", 0.0),  # 0.17 s: too short
        _shot(2.1, 6.0, "clip_09", 0.0, effects=[{"type": "EXPLODE"}], tr=("SPIN", 0.3)),  # unknown clip, effect, transition
        _shot(6.0, 9.0, "clip_01", 1.5, speed=5.0),  # too fast, and the same footage as shot 1
        _shot(9.0, 11.0, "clip_03", 7.5, tr=("FLASH", 0.2)),  # runs past the end of the clip; the Reel is cut short
    ]}  # fmt: skip
    out = at.plan_timeline(_doc(), clips, start=0.0, duration=12.0, min_clip=0.4, provider=Editor(bad))
    tl = out["timeline"]
    assert tl[0]["timeline_start_sec"] == 0.0 and tl[-1]["timeline_end_sec"] == 12.0
    assert all(a["timeline_end_sec"] == b["timeline_start_sec"] for a, b in zip(tl, tl[1:]))  # back to back
    assert all(s["timeline_end_sec"] - s["timeline_start_sec"] >= 0.4 for s in tl)
    assert tl[0]["timeline_end_sec"] == 2.0  # snapped onto the beat
    assert all(s["clip_id"] in ("clip_01", "clip_02", "clip_03") for s in tl)
    assert all(0.5 <= s["speed"] <= 2.0 for s in tl) and all(s["source_end_sec"] <= 8.0 + 1e-6 for s in tl)
    spans = [(s["clip_id"], s["source_start_sec"], s["source_end_sec"]) for s in tl]
    for i, (c, a, b) in enumerate(spans):  # never the same moment twice
        assert not any(c == c2 and a < b2 - 0.05 and a2 < b - 0.05 for c2, a2, b2 in spans[i + 1:])
    assert all(not s["effects"] or s["effects"][0]["type"] in at.EFFECTS for s in tl)
    assert tl[-1]["transition_out"] is None and all(s["transition_out"]["type"] in at.TRANSITIONS for s in tl[:-1])
    text = " ".join(out["notes"])
    assert "unknown clip" in text and "EXPLODE" in text and "SPIN" in text and "speed 5.0" in text and "under 0.4" in text


def test_the_same_inputs_give_the_same_timeline_without_asking_again(clips):
    answer = {"timeline": [_shot(0.0, 6.0, "clip_01", 0.5), _shot(6.0, 12.0, "clip_02", 0.5, tr=None)]}
    store: dict = {}
    cache = (store.get, store.__setitem__)
    ai = Editor(answer)
    first = at.plan_timeline(_doc(), clips, 0.0, 12.0, provider=ai, cache=cache)
    again = at.plan_timeline(_doc(), clips, 0.0, 12.0, provider=ai, cache=cache)
    assert len(ai.requests) == 1 and again["cached"] and again["timeline"] == first["timeline"]
    at.plan_timeline(_doc(), clips, 0.0, 12.0, brief="start with the drop", provider=ai, cache=cache)
    assert len(ai.requests) == 2  # other instructions: a new plan


def test_only_the_reels_part_of_the_song_is_sent_in_reel_time():
    music = at.music_for_reel(_doc(duration=30.0), start=3.0, duration=6.0)
    assert music["beats"][0]["t"] == 0.0 and all(0 <= b["t"] <= 6.0 for b in music["beats"])
    drop = next(e for e in music["events"] if e["type"] == "MUSIC_DROP")
    assert drop["t"] == 1.0  # 4.0 s in the song = 1.0 s into the Reel
    assert [s["type"] for s in music["sections"]] == ["INTRO", "DROP"] and music["sections"][1]["start"] == 1.0
    assert any(b.get("downbeat") for b in music["beats"]) and music["energy_every_half_second"]


def test_a_failed_analysis_is_refused(clips):
    from app.core.errors import ValidationFailed

    with pytest.raises(ValidationFailed):
        at.plan_timeline({"status": "failed", "errors": ["silent"]}, clips, 0.0, 10.0, provider=Editor({"timeline": []}))



def test_cuts_snap_by_beat_confidence_and_stay_on_chosen_events(clips):
    doc = _doc()
    for b in doc["beats"]:
        b["confidence"] = 0.95 if b["time_sec"] == 2.0 else 0.1  # only the beat at 2.0 is sure
    answer = {"timeline": [
        _shot(0.0, 1.88, "clip_01", 0.5),  # 120 ms before the sure beat at 2.0: pulled onto it
        _shot(1.88, 2.94, "clip_02", 0.5),  # 60 ms before an unsure beat at 3.0: stays (a weak beat does not pull from that far)
        _shot(2.94, 3.76, "clip_03", 0.5),  # 10 ms past the roll's end (3.75), an event: it stays on the event
        _shot(3.76, 12.0, "clip_01", 3.0, tr=None),
    ]}  # fmt: skip
    tl = at.plan_timeline(doc, clips, 0.0, 12.0, min_clip=0.4, provider=Editor(answer))["timeline"]
    assert [s["timeline_end_sec"] for s in tl[:3]] == [2.0, 2.94, 3.75]
    assert all("confidence" in b for b in at.music_for_reel(doc, 0.0, 12.0)["beats"])


def test_the_ai_animates_shots_with_keyframes_and_effects_become_keyframes(clips):
    from app.video import keyframes as kf

    answer = {"timeline": [
        {**_shot(0.0, 2.0, "clip_01", 1.0, effects=[{"type": "GLOW"}, {"type": "ZOOM_IN", "start_offset_sec": 0, "duration_sec": 2.0},
                                                     {"type": "PUNCH_ZOOM", "start_offset_sec": 0.84, "duration_sec": 0.15}]),
         "keyframes": []},
        {**_shot(2.0, 4.0, "clip_02", 0.5), "keyframes": [{"t": 0, "zoom": 1.0, "x": -0.8}, {"t": 2.0, "zoom": 1.15, "x": 0.8, "ease": "ease_in_out"},
                                                          {"t": 5.0, "rotation": 45, "ease": "bounce"}]},
        _shot(4.0, 12.0, "clip_03", 0.0, effects=[{"type": "BEAT_PUNCH"}, {"type": "SHAKE", "start_offset_sec": 1.0}], tr=None),
    ]}  # fmt: skip
    out = at.plan_timeline(_doc(), clips, 0.0, 12.0, min_clip=0.4, provider=Editor(answer))
    text = " ".join(out["notes"])
    assert "bounce" in text and "rotation 45 -> 20" in text and "outside the 2.000 s shot" in text  # the AI's keyframes checked
    plan = at.AITimeline(timeline=out["timeline"])
    tl, notes = at.to_timeline(plan, {f"clip_0{i + 1}": c.clip_id for i, c in enumerate(clips)}, clips, None, 0.0)
    assert len(tl.segments) == 3  # one segment per shot: effects inside a shot no longer split it
    first, second, third = tl.segments
    assert first.looks == ["glow"] and first.effect == "none"  # the look and the zoom together
    zoom = kf.tracks(first.keyframes)["zoom"]
    assert any(abs(t - 0.84) < 1e-3 and v == pytest.approx(1.1) for t, v, _ in zoom)  # the punch lands at 0.84 s
    assert kf.value_at(zoom, 0.5) > 1.0  # the slow zoom-in before it
    assert kf.value_at(kf.tracks(second.keyframes)["x"], 1.0) == pytest.approx(0.0, abs=0.01)  # the AI's own pan, mid-way
    assert third.effect == "beat_punch" and "SHAKE left out" in " ".join(notes)  # one beat-reactive effect per shot


def test_a_speed_ramp_from_the_ai_gets_the_footage_it_needs(clips):
    answer = {"timeline": [
        {**_shot(0.0, 4.0, "clip_01", 1.0), "keyframes": [{"t": 0, "speed": 0.6}, {"t": 2.4, "speed": 0.6}, {"t": 4.0, "speed": 2.0, "ease": "ease_in"}]},
        _shot(4.0, 12.0, "clip_02", 0.0, tr=None),
    ]}  # fmt: skip
    out = at.plan_timeline(_doc(), clips, 0.0, 12.0, min_clip=0.4, provider=Editor(answer))
    first = out["timeline"][0]
    from app.models.timeline import Keyframe
    from app.video import keyframes as kf

    need = kf.source_seconds([Keyframe(**k) for k in first["keyframes"]], 4.0)
    assert first["source_end_sec"] - first["source_start_sec"] == pytest.approx(need, abs=0.02)  # not 4 s at speed 1
    assert first["speed"] == pytest.approx(need / 4.0, abs=0.01)
