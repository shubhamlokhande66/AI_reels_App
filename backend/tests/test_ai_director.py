"""AI creative director: the facts it receives, the safety layer that turns its plan into the EDL, and the pipeline."""

from __future__ import annotations

import json

import pytest

from app.ai.provider import set_provider
from app.ai.reel_director import ReelDirectorPlan, build_request, clip_facts, registries
from app.director.ai_plan import MIN_SHOT, DirectorPlanRejected, plan_to_timeline
from app.director.music_map import build_music_map
from app.models.timeline import EFFECT_TYPES, TRANSITION_TYPES
from app.styles import get_style, list_styles
from app.video import effects as fx
from tests.test_ai import FakeProvider
from tests.test_jobs_api import make_project, wait_job
from tests.test_timeline import make_audio, make_clip

STYLES = {s.id for s in list_styles() if s.id not in ("custom", "auto")}


@pytest.fixture(autouse=True)
def _reset():
    yield
    set_provider(None)


def setup(duration=12.0, n=4):
    audio = make_audio(duration=40)
    clips = [make_clip(f"id{i}", dur=6.0, sig_bin=i) for i in range(n)]
    mm = build_music_map(audio, 0.0, duration)
    _, alias = clip_facts(clips)
    return audio, clips, mm, alias


def shot(clip, start, end, dur, **kw):
    return {"clip": clip, "source_start": start, "source_end": end, "duration": dur, **kw}


def plan(shots, **kw):
    return ReelDirectorPlan.model_validate({"style": "luxury", "grade": "luxury", "reason": "slow reveal", "shots": shots, **kw})


def direct(p, duration=12.0, keep_style=False, **kw):
    audio, clips, mm, alias = setup(duration)
    return plan_to_timeline(p, alias, clips, mm, 0.0, duration, get_style("cinematic"), style_ids=STYLES, keep_style=keep_style, **kw), mm


# ---------------------------------------------------------------------- what the model receives
def test_facts_are_compact_and_use_aliases_and_registries():
    audio, clips, mm, _ = setup()
    clips[3].analysis.usable = False
    facts, alias = build_request(clips, audio, mm, 0.0, 12.0, {"luxury": "x"}, brief="gold rings", language="en", style_hint=None,
                                 captions=False, cta="Shop now", hook="", pace="balanced")  # fmt: skip
    assert alias == {"c1": "id0", "c2": "id1", "c3": "id2"}  # unusable clips are not offered; internal ids never sent
    assert '"id0"' not in json.dumps(facts) and all(c["clip"].startswith("c") for c in facts["clips"])
    c = facts["clips"][0]
    assert {"quality", "brightness", "sharpness", "motion", "shake", "scene_cuts", "usable_windows"} <= set(c)
    m = facts["music"]
    assert m["bpm"] == 120.0 and m["beats"][:3] == [0.0, 0.5, 1.0] and m["drops"] == [] and m["energy"]
    assert set(registries({})["effects"]) == set(EFFECT_TYPES)  # effects come from the registry, not a hard-coded list
    assert set(facts["allowed"]["transitions"]) == set(TRANSITION_TYPES)  # all of them, from the registry


def test_the_users_instructions_and_an_open_pace_reach_the_ai():
    audio, clips, mm, _ = setup(duration=60.0)
    ask = dict(language="en", style_hint=None, captions=False, cta="", hook="")
    facts, _ = build_request(clips, audio, mm, 0.0, 60.0, {"luxury": "x"}, brief="luxury close-ups, slow", pace="auto", **ask)
    assert facts["reel"]["instructions"] == "luxury close-ups, slow" and facts["reel"]["style"] == "choose"
    assert facts["reel"]["pace"] == "auto" and "auto" in facts["reel"]["pace_meaning"]
    fast, _ = build_request(clips, audio, mm, 0.0, 60.0, {"luxury": "x"}, brief="", pace="fast", **ask)
    assert facts["footage"]["min_shots"] == 12 < fast["footage"]["min_shots"] == 30  # a calm/auto Reel is not forced into short shots


# ---------------------------------------------------------------------- safety layer
def test_a_good_plan_becomes_an_exact_beat_synced_timeline():
    p = plan([shot("c1", 0.5, 2.5, 2.0, purpose="hook", effect="slow_zoom_in", beat_alignment="strong"),
              shot("c2", 1.0, 4.1, 3.1, transition="crossfade", effect="pan_left"),
              shot("c3", 0.0, 3.0, 2.9, effect="zoom_out", transition="flash"),
              shot("c4", 2.0, 6.0, 4.0, purpose="payoff", effect="slow zoom in")],
             overlays=[{"text": "New gold drop", "start": 0.3, "end": 2.0, "role": "hook"}], title="Gold", hashtags=["#gold", 5])  # fmt: skip
    d, mm = direct(p)
    tl = d.timeline
    assert tl.duration == 12.0 and tl.segments[0].timeline_start == 0 and tl.segments[-1].timeline_end == 12.0
    assert all(a.timeline_end == b.timeline_start for a, b in zip(tl.segments, tl.segments[1:]))  # contiguous
    beats = set(round(b.t, 3) for b in mm.beats)
    assert all(round(s.timeline_start, 3) in beats for s in tl.segments[1:])  # every cut on a beat
    assert [s.effect for s in tl.segments] == ["zoom_in", "pan_left", "zoom_out", "zoom_in"]
    assert tl.segments[1].transition_in.type == "dissolve" and tl.segments[0].transition_in.type == "cut"
    for i, s in enumerate(tl.segments):
        assert s.source_start < s.source_end <= 6.0 and s.source_start >= 0
        assert s.transition_in.duration <= 0.45 * s.length + 1e-6
        assert s.length >= MIN_SHOT
    assert tl.style == "luxury" and tl.color_grade == "luxury"
    assert [o.text for o in tl.overlays] == ["New gold drop"]
    assert d.post_copy == {"title": "Gold", "description": "", "hashtags": ["gold", "5"]}
    assert any("Effects mapped" in f and "slow zoom in->zoom_in" in f for f in d.fixes)


def test_bad_instructions_are_repaired_not_trusted():
    p = plan([shot("c9", 0, 2, 2), shot("clip c1", -5, 99, 3, speed=9, crop="stretch", focus_x=4, transition="portal"),
              shot("c2", 4, 1, 3, transition="flash"), shot("c3", 0, 3, 3, transition="flash"), shot("c4", 0, 3, 3)])  # fmt: skip
    d, _ = direct(p)
    tl = d.timeline
    assert len(tl.segments) == 4 and tl.duration == 12.0  # c9 does not exist: dropped
    first = tl.segments[0]
    assert first.clip_id == "id0" and 0.5 <= first.speed <= 2.0 and first.source_end <= 6.0 and first.source_start >= 0
    assert first.crop.framing == "auto" and first.crop.focus_x is None
    assert tl.segments[1].source_start < tl.segments[1].source_end  # reversed source times were ordered
    assert tl.segments[2].transition_in.type == "cut"  # never the same transition twice in a row
    assert any("unknown or unusable clip" in f for f in d.fixes) and any("speed 9x" in f for f in d.fixes)


def test_user_style_is_kept_and_unknown_grades_ignored():
    p = plan([shot("c1", 0, 3, 3), shot("c2", 0, 3, 3), shot("c3", 0, 3, 3), shot("c4", 0, 3, 3)], style="food", grade="neon")
    d, _ = direct(p, keep_style=True)
    assert d.timeline.style == "cinematic" and d.timeline.color_grade is None


def test_user_hook_and_cta_are_always_shown():
    p = plan([shot("c1", 0, 3, 3), shot("c2", 0, 3, 3), shot("c3", 0, 3, 3), shot("c4", 0, 3, 3)])
    d, _ = direct(p, hook_text="Wait for it", cta_text="Shop the collection")
    roles = {o.role: o for o in d.timeline.overlays}
    assert roles["hook"].text == "Wait for it" and roles["cta"].end == 12.0


@pytest.mark.parametrize("shots", [
    [],
    [shot("c1", 0, 1, 1.0)],  # 1 s of plan for a 12 s Reel
    [shot("zz", 0, 3, 3)] * 4,  # nothing usable
])  # fmt: skip
def test_unusable_plans_are_rejected(shots):
    with pytest.raises(DirectorPlanRejected):
        direct(plan(shots))


def test_every_registered_effect_survives_the_safety_layer():
    shots_ = [shot(f"c{i % 4 + 1}", 0, 2, 12 / len(EFFECT_TYPES), effect=e) for i, e in enumerate(EFFECT_TYPES)]
    d, _ = direct(plan(shots_))
    assert [s.effect for s in d.timeline.segments] == list(EFFECT_TYPES)
    assert fx.resolve_effect("pan_down") == ("pan_down", False)


# ---------------------------------------------------------------------- pipeline
def _director_reply(n=2, seconds=5.0):
    each = seconds / n
    return json.dumps({"style": "cinematic", "grade": "warm", "reason": "calm story", "title": "Slow Burn", "description": "A calm edit.",
                       "hashtags": ["calm"], "shots": [shot(f"c{i % 2 + 1}", 0.5, 0.5 + each, each, effect="pan_right" if i else "zoom_in",
                                                         transition="cut" if i == 0 else ("dissolve" if i % 2 else "fade")) for i in range(n)],
                       "overlays": [{"text": "Golden hour", "start": 0.4, "end": 2.0, "role": "hook"}]})  # fmt: skip


@pytest.mark.slow
async def test_generate_with_the_ai_director_end_to_end(client, media_dir):
    fake = FakeProvider([_director_reply(3)])
    set_provider(fake)
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_portrait.mp4"], style="auto", ai=True, duration=5)
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    proj = (await client.get(f"/api/projects/{pid}")).json()
    tl = proj["timeline"]
    assert len(fake.calls) == 1  # ONE call planned the whole Reel (no separate style / order / copy calls)
    assert tl["colorGrade"] == "warm" and tl["overlays"][0]["text"] == "Golden hour"
    assert {s["effect"] for s in tl["segments"]} <= {"zoom_in", "pan_right"}
    assert tl["ai"]["director"] is True and "director" in tl["ai"]["tasks"]
    assert any(n.startswith("AI director") for n in tl["notes"])
    assert proj["output"]["postCopy"]["title"] == "Slow Burn"
    log = proj["reelPlan"]["aiDirector"]  # what the AI decided, shot by shot, is on the project page
    assert log["idea"] == "calm story" and len(log["shots"]) == len(tl["segments"]) and log["grade"]["used"] == "warm"
    # regenerating the same version reuses the cached plan: no new AI call
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed" and len(fake.calls) == 1


@pytest.mark.slow
async def test_a_broken_director_falls_back_to_the_rules(client, media_dir):
    set_provider(FakeProvider(['{"style": "x", "shots": "nope"}']))
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_portrait.mp4"], ai=True, duration=5)
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    tl = (await client.get(f"/api/projects/{pid}")).json()["timeline"]
    assert any("AI director was not used" in w for w in tl["warnings"]) and tl["segments"]


def test_every_ai_decision_is_logged_with_what_was_used_and_why():
    p = plan([shot("c1", 0.5, 2.5, 2.0, effect="slow zoom in", transition="fade"),
              shot("c2", 1.0, 4.1, 3.1, transition="crossfade", effect="pan_left", speed=3),
              shot("c3", 0.0, 3.0, 2.9, transition="crossfade"), shot("c4", 2.0, 6.0, 4.0)])  # fmt: skip
    d, _ = direct(p)
    assert [row["shot"] for row in d.log] == [1, 2, 3, 4] and len(d.log) == len(d.timeline.segments)
    first, second, third = d.log[0], d.log[1], d.log[2]
    assert first["asked"]["effect"] == "slow zoom in" and first["used"]["effect"] == "zoom_in"
    assert any("not supported -> zoom_in" in c for c in first["changes"]) and any("first shot" in c for c in first["changes"])
    assert second["used"]["transition"] == "dissolve" and any("speed 3x -> 2x" in c for c in second["changes"])
    assert third["used"]["transition"] == "cut" and any("twice in a row" in c for c in third["changes"])
    for row, seg in zip(d.log, d.timeline.segments):
        assert row["used"]["start"] == round(seg.timeline_start, 2) and row["used"]["effect"] == seg.effect


def test_beat_snaps_are_timing_notes_not_corrections():
    p = plan([shot("c1", 0.5, 2.6, 2.13), shot("c2", 1.0, 4.0, 3.0), shot("c3", 0.0, 3.0, 3.0), shot("c4", 2.0, 5.87, 3.87)])
    d, _ = direct(p)
    assert d.log[1]["timing"] and "onto the beat" in d.log[1]["timing"]
    assert not any("cut " in c for row in d.log for c in row["changes"])  # the corrections list stays for real repairs


def test_the_director_is_told_each_clips_best_moments():
    from app.models.analysis import UsableWindow

    w = UsableWindow(start=0.0, end=8.0, quality=0.9, motion=0.5, brightness=0.6, sharpness=0.8,
                     motion_curve=[0.1] * 20 + [0.9] + [0.2] * 11, curve_dt=0.25)  # the action peaks at 5.0 s
    clip = make_clip("x", dur=8.0, windows=[w])
    rows, _ = clip_facts([clip])
    assert rows[0]["best_moments"] == [4.0, 5.0]  # the centre of the best part, and the action peak
    audio, clips, mm, _ = setup()
    facts, _ = build_request(clips, audio, mm, 0.0, 12.0, {"x": "y"}, brief="", language="en", style_hint=None, captions=False,
                             cta="", hook="", pace="balanced")  # fmt: skip
    assert "NOT 0.0 by default" in facts["rules"]["moments"]


def test_the_footage_message_says_the_real_reason():
    from app.director.ai_plan import _pick_footage
    from app.models.analysis import UsableWindow

    short_good = make_clip("id0", dur=10.0, windows=[UsableWindow(start=0.0, end=0.8, quality=0.8, motion=0.4, brightness=0.6, sharpness=0.8)])
    other = make_clip("id1", dur=10.0, sig_bin=4)
    used = {"id0": [], "id1": []}
    clip, a, b, speed, why = _pick_footage(short_good, 0.0, 3.0, 1.0, used, [short_good, other], {})
    assert clip.clip_id == "id1" and "are shorter (0.8s) than this 3.0s shot" in why[0] and "no unused good footage left" not in why[0]
    used["id0"] = [(0.0, 0.8)]
    long_good = make_clip("id2", dur=10.0, windows=[UsableWindow(start=0.0, end=4.0, quality=0.8, motion=0.4, brightness=0.6, sharpness=0.8)])
    used["id2"] = [(0.0, 4.0)]
    clip, *_, why = _pick_footage(long_good, 0.0, 2.0, 1.0, used, [long_good, other], {})
    assert "no unused good footage left" in why[0]



def test_timing_notes_show_only_the_beat_snap_not_the_length_fit():
    # the AI's shots add up to 11 s for a 12 s Reel: every shot is stretched, but each note shows only the small beat move
    p = plan([shot("c1", 0, 2.7, 2.7), shot("c2", 0, 2.8, 2.8), shot("c3", 0, 2.7, 2.7), shot("c4", 0, 2.8, 2.8)])
    d, _ = direct(p)
    import re

    for row in d.log:
        if row["timing"]:
            a, b = map(float, re.findall(r"(\d+\.\d+)s", row["timing"])[:2])
            assert abs(a - b) <= 0.3 + 1e-6, row["timing"]
    assert any("scaled by" in f for f in d.fixes)


def test_every_cut_lands_on_a_beat_even_between_distant_beats():
    # 90 BPM: beats 0.667 s apart, so a cut planned halfway between two beats is 0.333 s from both (beyond the 0.3 s
    # snap). It must still land on a beat, not stay off it.
    audio = make_audio(bpm=90.0, duration=40)
    clips = [make_clip(f"id{i}", dur=6.0, sig_bin=i) for i in range(4)]
    mm = build_music_map(audio, 0.0, 12.0)
    _, alias = clip_facts(clips)
    p = plan([shot(f"c{i % 4 + 1}", 0, 1.0, 1.0) for i in range(12)])  # cuts at 1, 2, 3 ... s: mid-beat every other time
    d = plan_to_timeline(p, alias, clips, mm, 0.0, 12.0, get_style("cinematic"), style_ids=STYLES, keep_style=True)
    beats = {round(t, 3) for t in mm.snap_points} | {round(t, 3) for t in mm.drops}
    off = [s.timeline_start for s in d.timeline.segments[1:] if round(s.timeline_start, 3) not in beats]
    assert off == [], off


@pytest.mark.slow
async def test_the_ai_corrects_its_own_plan_once_when_it_broke_the_rules(client, media_dir):
    bad = json.dumps({"style": "cinematic", "grade": "warm", "reason": "first try",
                      "shots": [shot("c1", 0.5, 2.0, 1.5, speed=9), shot("c2", 0.5, 2.0, 1.5, speed=9), shot("c1", 3.0, 4.5, 1.5, speed=9),
                                shot("c2", 3.0, 4.5, 1.5, speed=9)]})  # fmt: skip
    good = json.dumps({"style": "cinematic", "grade": "warm", "reason": "corrected", "title": "Fixed", "description": "Better.",
                       "shots": [shot("c1", 0.5, 2.0, 1.5), shot("c2", 0.5, 2.0, 1.5), shot("c1", 3.0, 4.0, 1.0), shot("c2", 3.0, 4.0, 1.0)]})  # fmt: skip
    fake = FakeProvider([bad, good])
    set_provider(fake)
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_portrait.mp4"], ai=True, duration=5)
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert len(fake.calls) == 2 and "Your previous plan broke these rules" in fake.calls[1][1] and "speed 9x" in fake.calls[1][1]
    log = proj["reelPlan"]["aiDirector"]
    assert log["idea"] == "corrected" and log["revision"]["used"] is True and log["revision"]["after"] < log["revision"]["before"]
    assert any("revised its own plan" in n for n in proj["timeline"]["notes"])


def test_extra_time_goes_to_shots_with_spare_footage_so_tight_shots_still_fit():
    from app.models.analysis import UsableWindow

    tight = make_clip("id0", dur=10.0, windows=[UsableWindow(start=0.0, end=1.4, quality=0.9, motion=0.4, brightness=0.6, sharpness=0.8)])
    roomy = [make_clip(f"id{i}", dur=10.0, sig_bin=i * 4) for i in (1, 2, 3)]
    clips = [tight, *roomy]
    mm = build_music_map(make_audio(duration=40), 0.0, 12.0)
    _, alias = clip_facts(clips)
    # 1.4 + 3 x 2.8 = 9.8 s for a 12 s Reel: stretching every shot evenly would push shot 1 past its 1.4 s good part
    p = plan([shot("c1", 0.0, 1.4, 1.4), shot("c2", 0, 2.8, 2.8), shot("c3", 0, 2.8, 2.8), shot("c4", 0, 2.8, 2.8)])
    d = plan_to_timeline(p, alias, clips, mm, 0.0, 12.0, get_style("cinematic"), style_ids=STYLES, keep_style=True)
    assert d.timeline.segments[0].clip_id == "id0" and d.log[0]["changes"] == []  # kept its clip: no swap needed
    assert d.timeline.duration == 12.0 and d.timeline.segments[-1].timeline_end == 12.0
