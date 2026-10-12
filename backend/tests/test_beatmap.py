"""The music-first screen's beat map: every beat classed, with a real renderer effect and an exact time."""

from __future__ import annotations

import pytest

from app.audio.analyzer import analyze_audio
from app.audio.beatmap import beat_map


def test_every_beat_is_listed_in_order_with_an_effect_the_renderer_has(media_dir):
    m = beat_map(analyze_audio(media_dir / "beat120.wav"))
    assert abs(m["bpm"] - 120) < 3 and abs(m["beatSeconds"] - 0.5) < 0.02
    times = [e["t"] for e in m["events"]]
    assert times == sorted(times)
    beats = [e for e in m["events"] if e["kind"] in ("major", "beat")]
    assert len(beats) >= m["seconds"] / 0.5 * 0.8  # (nearly) every beat of the click track
    assert m["counts"]["major"] >= 1 and m["counts"]["major"] + m["counts"]["beat"] == len(beats)
    renderer = {"crash_zoom", "beat_punch", "punch", "zoom_in", "zoom_pulse", "none", "beat_flash", "ken_burns"}
    assert {e["effect"] for e in m["events"]} <= renderer and all(e["effectLabel"] and e["why"] for e in m["events"])
    assert len(m["energy"]) == len(m["rhythm"]) > 0 and m["curveStep"] == 0.25


async def test_the_beat_map_endpoint(client, media_dir):
    pid = (await client.post("/api/projects", json={"name": "Music first"})).json()["id"]
    assert (await client.get(f"/api/projects/{pid}/beat-map")).status_code == 422  # no song yet
    await client.post(f"/api/projects/{pid}/audio", files={"file": ("beat120.mp3", (media_dir / "beat120.mp3").read_bytes(), "audio/mpeg")})
    r = await client.get(f"/api/projects/{pid}/beat-map")
    assert r.status_code == 200 and r.json()["events"] and "trends" in r.json()


def _song():
    """A 70-per-minute beat (0.86 s apart), strong hits on some beats, hard hits between beats, a drop at 3.88 s."""
    from app.models.analysis import AudioAnalysis, Section

    p = 0.86
    beats = [round(i * p, 3) for i in range(24)]
    strong = [beats[i] for i in (1, 4, 6, 9, 12, 15, 18)]
    hard = [3.3, 3.71, 11.0]
    return AudioAnalysis(bpm=139.5, duration=20.5, beats=beats[:20], beat_confidence=1.0, strong_beats=strong, drops=[3.44],
                         onsets=[round(b + 0.14 * k, 3) for b in beats[:20] for k in (1, 2, 3)], accents=strong + hard,
                         accent_strengths=[1.0] * (len(strong) + len(hard)), energy_hop=0.1,
                         energy=[0.3 if i < 34 else 0.85 for i in range(205)], sections=[Section(start=3.44, end=20.5)])  # fmt: skip


def test_the_plan_reads_like_an_editors_sheet():
    from app.audio.beatmap import beat_grid, beat_map

    a = _song()
    beats, period = beat_grid(a)
    assert abs(period - 0.86) < 0.01 and beats[-1] > 19.5  # the steady grid is carried on to the end
    m = beat_map(a)
    assert abs(m["bpm"] - 69.8) < 0.5 and m["trackerBpm"] == 139.5  # the speed of the beats listed, not the tracker's double
    plan = m["plan"]
    assert plan[0]["transition"] == "fade_in" and "Hero shot" in [p for p in plan if p["kind"] == "cut"][-1]["shot"]
    cuts = [p["t"] for p in plan if p["kind"] == "cut"][1:]
    assert all(any(abs(c - b) < 0.01 for b in beats) for c in cuts)  # every cut on a beat
    assert 0.8 <= sum(y - x for x, y in zip(cuts, cuts[1:])) / max(len(cuts) - 1, 1) <= 2.6  # beats 0.86 s apart: a cut every 1-2 beats
    assert all(y - x >= 0.35 for x, y in zip(cuts, cuts[1:]))
    # 3.71 is a hard hit 0.27 s after the drop's flash cut: flashes stay rare, so it gets a punch, not a second flash;
    # 3.3 sits under 0.25 s before the drop's cut: a speed ramp into it
    assert [p["t"] for p in plan if p["kind"] == "flash"] == []
    assert next(p for p in plan if p["t"] == 3.71)["effect"] in ("beat_punch", "zoom_pulse")  # marked, but no second flash
    ramps = [p["t"] for p in plan if p["kind"] == "ramp"]
    assert 3.3 in ramps and all(any(0 < c - r < 0.25 for c in [q["t"] for q in plan if q["kind"] == "cut"]) for r in ramps)
    # steady hi-hats are the groove: no stutter punches on them (only a roll into a drop gets those)
    assert not [p for p in plan if p["effect"] == "beat_stutter" and p["kind"] == "hit"]
    flash_cuts = [p["t"] for p in plan if p.get("transition") == "flash"]
    assert all(y - x >= 2.9 for x, y in zip(flash_cuts, flash_cuts[1:]))  # not every hit flashes
    subs = [e for e in m["events"] if e["kind"] == "sub"]
    assert len(subs) >= 40  # every small hit between beats is still listed


def test_a_reel_cut_by_the_plan_follows_it():
    from app.audio.beatmap import cut_plan
    from app.styles import get_style
    from app.video.timeline import build_timeline
    from tests.test_timeline import make_clip

    a = _song()
    clips = [make_clip(f"c{i}", dur=12.0) for i in range(6)]
    tl = build_timeline(a, clips, 15, get_style("fast_trending"), seed=3, audio_start=0.0, beat_plan=True)
    plan = cut_plan(a, start=0.0, end=15.0)
    want = [p["t"] for p in plan if p["kind"] == "cut" and p["transition"] != "fade_in"]
    flashes = [p["t"] for p in plan if p["kind"] == "flash"]
    # every shot comes in with a transition that lands on its beat: it ends on the beat (a flash peaks on it)
    def lands(s):
        t = s.transition_in
        if t.type == "speed_ramp":  # the previous shot speeds up into the cut: the cut itself is at the start
            return round(s.timeline_start, 2)
        return round(s.timeline_start + (t.duration / 2 if t.type == "flash" else t.duration), 2)
    planned = [s for s in tl.segments[1:] if s.effect != "beat_flash"]
    smooth = sum(s.transition_in.type != "cut" for s in planned)
    assert 1 <= smooth < len(planned) / 2  # pace rules: transitions are occasional, most cuts are hard cuts on the beat
    assert [lands(s) for s in planned] == [round(w, 2) for w in want]
    assert [round(s.timeline_start, 3) for s in tl.segments if s.effect == "beat_flash"] == flashes
    assert all(s.locked for s in tl.segments) and tl.picture_fade is None  # the fade is set by the pipeline
    drop = next(s for s in tl.segments if abs(s.timeline_start + s.transition_in.duration / 2 - 3.44) < 0.01)
    assert drop.effect == "crash_zoom" and drop.transition_in.type == "flash"


def test_no_beat_is_missed():
    """Every beat of the chosen part is a cut or a pulse inside the shot, and every hard hit between beats is marked;
    small steady hits (hi-hats) are left alone, and an accent gets at most one punch per shot."""
    from app.audio.beatmap import Song, cut_plan, missed_beats, plan_hits

    a = _song()
    for start, end in ((0.0, 15.0), (2.0, 20.0)):
        rows = cut_plan(a, start=start, end=end)
        assert missed_beats(a, rows, start, end) == []
        held = [r for r in rows if r.get("pulses")]
        assert all(r["effect"] in ("beat_punch", "zoom_pulse", "beat_stutter", "crash_zoom") for r in held) and set(plan_hits(rows)) == {b for r in held for b in r["pulses"]}
        marked = [r["t"] for r in rows if r["kind"] in ("flash", "ramp", "zoom", "hit")]
        cuts = [r["t"] for r in rows if r["kind"] == "cut"]
        for t in Song(a).hard_subs(start + 0.2, end - 1.8):
            assert t in marked or any(abs(t - c) < 0.06 for c in cuts), t  # a hard hit is never left out
        for c, nxt in zip(cuts, cuts[1:] + [end]):  # no shot is crowded with punches
            assert sum(1 for r in rows if r["kind"] == "hit" and r["effect"] == "beat_punch" and c < r["t"] < nxt) <= 1



def test_the_pace_follows_how_far_apart_the_beats_are():
    """director/pace_rules.py: slow songs cut on every beat with smooth transitions; fast beats are grouped so no shot
    is too short; hits faster than 0.2 s never get a cut each."""
    from app.director import pace_rules as pr

    assert [pr.pace_for(g).name for g in (1.0, 0.6, 0.45, 0.3, 0.15)] == ["slow", "medium", "medium_fast", "fast", "roll"]
    assert pr.cut_step(pr.pace_for(1.0), 1.0, loud=True) == 1
    assert pr.cut_step(pr.pace_for(0.6), 0.6, loud=True) == 1 and pr.cut_step(pr.pace_for(0.6), 0.6, loud=False) == 2
    assert pr.cut_step(pr.pace_for(0.45), 0.45, loud=True) == 2
    assert pr.cut_step(pr.pace_for(0.45), 0.45, loud=True, in_drop=True) == 1  # every beat right after a drop
    assert pr.cut_step(pr.pace_for(0.3), 0.3, loud=True, min_shot=0.4) * 0.3 >= 0.4  # never under the minimum shot
    assert pr.cut_step(pr.pace_for(0.15), 0.15, loud=True) * 0.15 >= 0.6  # a roll: a longer shot, not a cut per hit
    assert pr.cut_step(pr.pace_for(0.6), 0.6, loud=False, trend="rise") == 1  # build-ups faster
    assert pr.cut_step(pr.pace_for(0.6), 0.6, loud=True, trend="fall") == 2  # breakdowns slower
    slow, roll = pr.pace_for(1.0), pr.pace_for(0.15)
    assert pr.wants_transition(slow, 3, False) and not pr.wants_transition(slow, 1, False) and not pr.wants_transition(roll, 99, True)
    assert pr.transition_seconds(slow, 0.5, 1.0, shot=0.8) <= 0.32  # at most 40% of the shot
    rules = pr.describe(0.45)
    assert rules["this_song"]["pace"] == "medium_fast" and len(rules["table"]) == 5


def test_a_reel_cut_by_the_plan_gets_keyframes_and_ramps_from_the_music():
    """director/plan_motion.py: calm shots push in slowly, the drop comes with speed ramps (into it and off it), and a
    ramped shot always reads exactly the footage its speed track plays."""
    from app.styles import get_style
    from app.video import keyframes as kf
    from app.video.timeline import build_timeline
    from tests.test_timeline import make_clip

    a = _song()
    tl = build_timeline(a, [make_clip(f"c{i}", dur=12.0) for i in range(6)], 15, get_style("fast_trending"), seed=3, audio_start=0.0, beat_plan=True)
    ramped = [s for s in tl.segments if kf.has_speed(s.keyframes)]
    assert 1 <= len(ramped) <= 3  # a budget: ramps are for the key moments
    for s in ramped:
        assert s.source_end - s.source_start == pytest.approx(kf.source_seconds(s.keyframes, s.length), abs=0.01)
        assert s.speed == pytest.approx(kf.average_speed(s.keyframes, s.length), abs=0.01)
    drop_shot = next(s for s in tl.segments if s.effect == "crash_zoom")
    k = tl.segments.index(drop_shot)
    assert kf.has_speed(drop_shot.keyframes) or (k > 0 and kf.has_speed(tl.segments[k - 1].keyframes))  # the drop gets its ramp
    assert any("Speed ramps" in n for n in tl.notes)
    calm = [s for s in tl.segments if s.timeline_end <= 3.4 and s.length >= 1.2]
    assert all(kf.animates(s.keyframes, ["zoom"]) for s in calm)  # calm shots push in



def test_the_opening_shot_never_ramps_even_when_the_song_part_starts_on_a_drop():
    from app.director.plan_motion import Shot, decide

    a = _song()
    shots = [Shot(0.0, 1.0, "zoom_pulse"), Shot(1.0, 2.0, "crash_zoom", 0.2), Shot(2.0, 3.0)]
    motions = decide(shots, a, audio_start=3.44)  # the Reel starts on the drop at 3.44 s
    assert motions[0].ramp == ""  # the opening fades in: no ramp
    assert motions[1].ramp in ("out_of_drop", "")
