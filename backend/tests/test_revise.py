"""Change requests in plain words: parsing, translation to EDL operations, and the REST flow end to end."""

from __future__ import annotations

import pytest
from bson import ObjectId

from app.ai.provider import set_provider
from app.core.errors import AIUnavailable
from app.revise import actions as rv
from app.styles import get_style
from app.video.timeline import build_timeline
from tests.test_ai import FakeProvider
from tests.test_editor_api import seeded
from tests.test_jobs_api import wait_job
from tests.test_timeline import make_audio, make_clip


class NoAI(FakeProvider):
    def health(self):
        return {"available": False, "model": None, "detail": "off"}


@pytest.fixture(autouse=True)
def _no_ai():
    set_provider(NoAI())
    yield
    set_provider(None)


def kinds(text: str):
    acts, unknown = rv.parse_rules(text)
    return [(a.kind, a.value, a.scope, a.shot) for a in acts], unknown


# ------------------------------------------------------------------ the phrase parser
@pytest.mark.parametrize("text,expected", [
    ("make it calmer", [("pace", "calm", "all", None)]),
    ("the cuts are too fast", [("pace", "calm", "all", None)]),
    ("too fast", [("pace", "calm", "all", None)]),
    ("I want longer shots", [("pace", "calm", "all", None)]),
    ("faster cuts please", [("pace", "fast", "all", None)]),
    ("more energetic", [("pace", "fast", "all", None)]),
    ("add captions", [("captions_on", None, "all", None)]),
    ("remove the captions", [("captions_off", None, "all", None)]),
    ("no subtitles", [("captions_off", None, "all", None)]),
    ("use bold captions", [("caption_style", "bold", "all", None)]),
    ("make it 20 seconds", [("duration", 20.0, "all", None)]),
    ("keep it under 12 sec", [("duration", 12.0, "all", None)]),
    ("smoother transitions", [("transition", "dissolve", "all", None)]),
    ("no transitions", [("transition", "cut", "all", None)]),
    ("louder music", [("music_volume", None, "all", None)]),
    ("mute the music", [("mute_music", None, "all", None)]),
    ("use the luxury style", [("style", "luxury", "all", None)]),
    ("make it more cinematic", [("style", "cinematic", "all", None)]),
    ("show a different order", [("reshuffle", None, "all", None)]),
    ("remove the watermark", [("watermark_off", None, "all", None)]),
    ("slow motion", [("speed", 0.5, "all", None)]),
    ("normal speed", [("speed", 1.0, "all", None)]),
    ("fill the screen", [("framing", "fill", "all", None)]),
    ("show the whole picture", [("framing", "fit", "all", None)]),
])
def test_single_phrases(text, expected):
    got, unknown = kinds(text)
    assert got == expected and unknown == []


def test_shot_references_and_scopes():
    assert kinds("remove the first clip")[0] == [("delete", None, "first", None)]
    assert kinds("delete the last shot")[0] == [("delete", None, "last", None)]
    assert kinds("remove shot 3")[0] == [("delete", None, "shot", 3)]
    assert kinds("drop the 4th clip")[0] == [("delete", None, "shot", 4)]
    assert kinds("add a zoom on the second shot")[0] == [("effect", "zoom_in", "shot", 2)]
    assert kinds("no effects")[0] == [("effect", "none", "all", None)]
    assert kinds("move the last clip to the start")[0] == [("move", None, "last", None)]
    assert kinds("put the last shot first")[0] == [("move", None, "last", None)]


def test_pace_versus_playback_speed():
    """"slower cuts" changes the edit rhythm; "slow down the footage" changes playback speed."""
    assert kinds("slower cuts")[0][0][:2] == ("pace", "calm")
    assert kinds("slow down the footage")[0][0][0] == "speed"
    assert kinds("speed up the clips")[0][0][0] == "speed"
    assert kinds("slower")[0][0][:2] == ("pace", "calm")  # a bare "slower" means the editing, as the user meant before


def test_several_requests_in_one_sentence():
    got, unknown = kinds("Make it calmer, remove the first clip and add captions. Also louder music")
    assert [g[0] for g in got] == ["pace", "delete", "captions_on", "music_volume"] and unknown == []


def test_unknown_text_is_reported_not_guessed():
    got, unknown = kinds("make it feel like a dream, remove the first clip")
    assert [g[0] for g in got] == ["delete"] and unknown == ["make it feel like a dream"]
    assert kinds("hello there")[0] == [] and kinds("hello there")[1] == ["hello there"]


def test_length_complaints_about_a_part_do_not_shorten_the_whole_reel():
    """Regression: "the ending feels too long" used to become "make the whole Reel shorter"."""
    assert kinds("the ending feels too long")[0] == []
    assert kinds("the first shot is too long")[0] == []
    assert kinds("it is too long")[0] == [("duration", None, "all", None)]
    assert kinds("make it shorter")[0] == [("duration", None, "all", None)]


def test_actions_carry_the_words_they_came_from():
    acts, _ = rv.parse_rules("remove the first clip")
    assert acts[0].text == "remove the first clip" and acts[0].source == "rules"


# ------------------------------------------------------------------ actions -> operations
def make_tl(n_dur=8):
    clips = [make_clip(f"c{i}", dur=12, sig_bin=i * 6) for i in range(4)]
    return build_timeline(make_audio(), clips, n_dur, get_style("cinematic"), seed=3)


def to_ops(text, tl=None, **kw):
    tl = tl or make_tl()
    acts, _ = rv.parse_rules(text)
    return rv.actions_to_ops(acts, tl, **kw), tl


def test_delete_uses_original_numbering_and_keeps_one_shot():
    (out, notes, applied), tl = to_ops("remove shot 1 and remove shot 2")
    deletes = [o for o in out if o.type == "delete"]
    assert [d.segment_id for d in deletes] == [tl.segments[0].id, tl.segments[1].id]
    (out, notes, _), tl = to_ops("remove shot 9")
    assert not out and "no shot 9" in notes[0].lower()
    tl1 = make_tl()
    tl1.segments = tl1.segments[:1]
    (out, notes, _), _ = to_ops("remove the first clip", tl1)
    assert not [o for o in out if o.type == "delete"] and "at least one" in notes[0]


def test_speed_factor_and_absolute():
    (out, _, _), tl = to_ops("slow down the shots")
    assert [o.speed for o in out] == [round(s.speed * 0.75, 3) for s in tl.segments]
    (out, _, _), tl = to_ops("slow motion on the last shot")
    assert len(out) == 1 and out[0].segment_id == tl.segments[-1].id and out[0].speed == 0.5


def test_music_volume_is_clamped_and_chained():
    tl = make_tl()
    tl.music_volume = 1.4
    (out, _, _), _ = to_ops("louder music", tl)
    assert out[0].volume == 1.5  # never above the limit
    (out, _, _), _ = to_ops("quieter music, quieter music", make_tl())
    assert [o.volume for o in out] == [0.75, 0.5]  # each step builds on the previous one


def test_duration_is_limited_by_the_music_and_the_product_limits():
    (out, notes, _), _ = to_ops("make it 200 seconds", audio_duration=30)
    assert out[0].type == "fit_duration" and out[0].target == 30 and "outside" in notes[0]
    (out, notes, _), _ = to_ops("make it 2 seconds")
    assert out[0].target == 5


def test_requests_that_do_nothing_are_explained():
    (out, notes, _), _ = to_ops("remove the captions")
    assert not out and "no captions" in notes[0].lower()
    (out, notes, _), _ = to_ops("louder voice")
    assert not out and "no voice" in notes[0].lower()
    (out, notes, _), _ = to_ops("remove the watermark")
    assert not out and "no watermark" in notes[0].lower()


def test_first_shot_never_gets_a_transition():
    (out, _, _), tl = to_ops("smoother transitions")
    assert {o.segment_id for o in out} == {s.id for s in tl.segments[1:]}


def test_rebuild_actions_become_generation_settings():
    acts, _ = rv.parse_rules("use the luxury style, calmer, add captions, make it 30 seconds")
    o = rv.rebuild_overrides(acts)
    assert o == {"style": "luxury", "pace": "calm", "captions": True, "duration": 30, "seed": 0}
    acts, _ = rv.parse_rules("show a different order")
    assert rv.rebuild_overrides(acts)["seed"] > 0


# ------------------------------------------------------------------ the LLM path is validated, never trusted
STYLES = {"cinematic", "luxury", "fast_trending"}


def test_ai_actions_are_validated():
    data = {"actions": [
        {"action": "speed", "scope": "shot", "shot": 2, "factor": 0.5},
        {"action": "effect", "scope": "all", "value": "explode"},          # unknown value
        {"action": "delete", "scope": "shot", "shot": 99},                 # no such shot
        {"action": "format_disk"},                                         # unknown action
        {"action": "style", "value": "luxury"},
        {"action": "duration", "value": 99999},                           # clamped to the product limit
        "junk",
    ], "unclear": "wants a dreamy feel"}
    acts, dropped = rv.parse_ai_actions(data, 4, STYLES)
    assert [(a.kind, a.value) for a in acts] == [("speed", None), ("style", "luxury"), ("duration", 600.0)]
    assert acts[0].shot == 2 and acts[0].source == "ai"
    assert any("explode" in d for d in dropped) and any("no such shot" in d for d in dropped) and any("format_disk" in d for d in dropped)
    assert "dreamy" in dropped[-1]


def test_ai_fills_in_what_the_rules_do_not_know():
    fake = FakeProvider(replies=['{"actions":[{"action":"pace","value":"calm"}],"unclear":""}'])
    plan = rv.plan_revision("give it a dreamy feel, remove the first clip", make_tl(), {"pace": "balanced"}, fake)
    assert plan.used_ai and [a.kind for a in plan.actions] == ["delete", "pace"]
    assert [a.source for a in plan.actions] == ["rules", "ai"] and plan.not_understood == []
    assert "dreamy" in fake.calls[0][1] and "remove the first clip" not in fake.calls[0][1]  # only the unclear part is sent


def test_ai_failure_keeps_the_rules_result_and_says_why():
    fake = FakeProvider(error=AIUnavailable("Cannot reach Ollama", code="OLLAMA_UNAVAILABLE"))
    plan = rv.plan_revision("give it a dreamy feel, remove the first clip", make_tl(), {}, fake)
    assert [a.kind for a in plan.actions] == ["delete"] and plan.not_understood == ["give it a dreamy feel"]
    assert "could not help" in plan.ai_note
    plan = rv.plan_revision("dreamy feel", make_tl(), {}, None)
    assert plan.actions == [] and "not available" in plan.ai_note


# ------------------------------------------------------------------ REST flow
async def revise(client, pid, text, **kw):
    return await client.post(f"/api/projects/{pid}/revise", json={"instruction": text, **kw})


async def test_revise_needs_a_reel_and_an_instruction(client, db, media_dir):
    from tests.test_jobs_api import make_project

    pid = await make_project(client, media_dir, videos=["clip_a.mp4"])
    r = await revise(client, pid, "make it calmer")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NO_TIMELINE"
    assert (await client.post(f"/api/projects/{pid}/revise", json={"instruction": ""})).status_code == 422


async def test_a_long_instruction_is_accepted_up_to_3000_characters(client, db, media_dir):
    """A detailed brief, not just a short phrase, should not be rejected just for its length."""
    pid, tl = await seeded(client, db, media_dir)
    r = await revise(client, pid, "make it calmer. " * 180)  # ~2880 chars, under the limit
    assert r.status_code != 422
    r = await revise(client, pid, "x" * 3001)
    assert r.status_code == 422


async def test_unclear_request_changes_nothing_and_gives_examples(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    before = (await client.get(f"/api/projects/{pid}/timeline")).json()
    r = await revise(client, pid, "give it a dreamy feel")
    j = r.json()
    assert r.status_code == 200 and j["mode"] == "none" and j["job"] is None
    assert j["notUnderstood"] == ["give it a dreamy feel"] and j["examples"] and "not available" in j["aiNote"]
    assert (await client.get(f"/api/projects/{pid}/timeline")).json()["version"] == before["version"]


async def test_dry_run_explains_without_touching_anything(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    before = (await client.get(f"/api/projects/{pid}/timeline")).json()["version"]
    j = (await revise(client, pid, "remove the first clip and louder music", dryRun=True)).json()
    assert j["mode"] == "edit" and j["job"] is None
    assert [u["does"] for u in j["understood"]] == ["Remove the first shot", "Music louder"]
    assert (await client.get(f"/api/projects/{pid}/timeline")).json()["version"] == before
    j = (await revise(client, pid, "calmer with the luxury style", dryRun=True)).json()
    assert j["mode"] == "rebuild" and j["overrides"]["pace"] == "calm" and j["overrides"]["style"] == "luxury"


async def test_bad_shot_number_is_reported(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    j = (await revise(client, pid, "remove shot 42")).json()
    assert j["mode"] == "none" and "no shot 42" in j["notes"][0].lower() and j["job"] is None


@pytest.mark.slow
async def test_edit_request_is_applied_rendered_and_kept_as_a_labelled_version(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    n = len(tl.segments)
    r = await revise(client, pid, "remove the first clip, slow motion on the last shot, louder music")
    j = r.json()
    # removing a shot is destructive: it is shown first and applied only after the user confirms
    assert r.status_code == 200 and j["needsConfirmation"] and j["job"] is None
    r = await revise(client, pid, "remove the first clip, slow motion on the last shot, louder music", confirmedActions=j["actions"])
    j = r.json()
    assert r.status_code == 200 and j["mode"] == "edit" and j["job"]["type"] == "render"
    assert len(j["understood"]) == 3
    done, _ = await wait_job(client, pid, j["job"]["id"])
    assert done["status"] == "completed", done

    st = (await client.get(f"/api/projects/{pid}/timeline")).json()
    assert len(st["timeline"]["segments"]) == n - 1 and st["timeline"]["musicVolume"] > 1.0
    assert st["timeline"]["segments"][-1]["speed"] == 0.5
    assert st["history"][-1]["label"].startswith("remove the first clip")
    # undo brings the original back: the request is one undoable step
    u = (await client.post(f"/api/projects/{pid}/timeline/undo")).json()
    assert len(u["timeline"]["segments"]) == n

    rs = (await client.get(f"/api/projects/{pid}/renderings")).json()
    assert rs[0]["label"].startswith("remove the first clip") and rs[0]["kind"] == "final"
    out = await client.get(rs[0]["url"])
    assert out.status_code in (200, 206) and len(out.content) > 10_000


@pytest.mark.slow
async def test_rebuild_request_creates_a_new_version_and_applies_the_other_requests(client, db, media_dir):
    from tests.test_jobs_api import make_project

    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_d.mp4", "clip_portrait.mp4"], duration=8)
    first = await client.post(f"/api/projects/{pid}/generate")
    assert (await wait_job(client, pid, first.json()["id"]))[0]["status"] == "completed"
    before = (await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]

    r = await revise(client, pid, "make it calmer and louder music, remove the first clip")
    j = r.json()
    assert j["needsConfirmation"] and j["job"] is None  # includes a removal: confirm first
    r = await revise(client, pid, "make it calmer and louder music, remove the first clip", confirmedActions=j["actions"])
    j = r.json()
    assert j["mode"] == "rebuild" and j["job"]["type"] == "generate"
    assert any("Shot-level changes" in w for w in j["warnings"])  # "remove the first clip" cannot survive a rebuild
    done, _ = await wait_job(client, pid, j["job"]["id"])
    assert done["status"] == "completed", done

    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["settings"]["pace"] == "calm"
    after = (await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]
    assert after["musicVolume"] > before["musicVolume"]  # the follow-up request was applied to the new edit
    # calmer = longer shots = no more of them (the quick "punch" pieces that answer strong hits in the song are extra splits, not shots)
    whole = lambda t: [s for s in t["segments"] if s.get("effect") != "punch"]
    assert len(whole(after)) <= len(whole(before))
    assert len((await client.get(f"/api/projects/{pid}/renderings")).json()) == 2  # the first version is kept
    assert proj["output"]["label"].startswith("make it calmer")


def test_ai_cannot_act_on_shots_or_removals_the_user_never_mentioned():
    """Regression seen with a real 4B model: "trim the last shot to be punchier" came back as "remove shot 14"."""
    fake = FakeProvider(replies=['{"actions":[{"action":"delete","scope":"shot","shot":3}],"unclear":""}'])
    plan = rv.plan_revision("the ending feels too long, trim the last shot to be punchier", make_tl(), {}, fake)
    assert plan.actions == [] and "did not match what you asked" in plan.ai_note and "shot 3" in plan.ai_note
    # a removal the user did ask for, on a shot the user named, is accepted
    fake = FakeProvider(replies=['{"actions":[{"action":"delete","scope":"shot","shot":3}],"unclear":""}'])
    plan = rv.plan_revision("get rid of the boring third part please, it drags", make_tl(), {}, fake)
    assert [(a.kind, a.shot) for a in plan.actions] == [("delete", 3)]
    # "first"/"last" must also come from the user's words
    fake = FakeProvider(replies=['{"actions":[{"action":"speed","scope":"last","factor":0.5}],"unclear":""}'])
    assert rv.plan_revision("make it feel dreamy", make_tl(), {}, fake).actions == []


def test_confirmed_plans_are_revalidated():
    good = {"kind": "speed", "scope": "last", "factor": 0.5, "text": "x", "source": "ai"}
    bad = [{"kind": "delete", "scope": "shot", "shot": 99}, {"kind": "format_disk"}, {"kind": "effect", "value": "explode"}, "junk"]
    out = rv.actions_from_dicts([*bad, good, {"kind": "mute_music", "source": "rules", "text": "mute"}], 4)
    assert [(a.kind, a.source) for a in out] == [("speed", "ai"), ("mute_music", "rules")]
    assert rv.actions_from_dicts([{"kind": "duration", "factor": 0.75}], 4)[0].factor == 0.75  # relative lengths survive


class LiveAI(FakeProvider):
    """A reachable model: health() returns a dict, like the real providers."""


async def test_reachable_model_interprets_what_the_rules_do_not_know(client, db, media_dir):
    """Regression: the API once read health().available on a dict, silently disabling the AI."""
    pid, tl = await seeded(client, db, media_dir)
    fake = LiveAI(replies=['{"actions":[{"action":"speed","scope":"last","factor":0.5}],"unclear":""}'])
    set_provider(fake)
    j = (await revise(client, pid, "make the ending dramatic and remove the first clip", dryRun=True)).json()
    assert j["usedAi"] is True and j["notUnderstood"] == [] and j["aiNote"] is None
    assert [u["source"] for u in j["understood"]] == ["rules", "ai"] and j["understood"][0]["does"] == "Remove the first shot"
    assert len(fake.calls) == 1 and "dramatic" in fake.calls[0][1]


async def test_ai_interpreted_changes_wait_for_the_users_confirmation(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    before = (await client.get(f"/api/projects/{pid}/timeline")).json()["version"]
    set_provider(LiveAI(replies=['{"actions":[{"action":"speed","scope":"last","factor":0.5}],"unclear":""}']))
    j = (await revise(client, pid, "make the ending dramatic")).json()  # not a dry run: still nothing may be applied
    assert j["needsConfirmation"] is True and j["mode"] == "edit" and j["job"] is None
    assert j["actions"][0]["kind"] == "speed" and j["actions"][0]["source"] == "ai"
    assert (await client.get(f"/api/projects/{pid}/timeline")).json()["version"] == before
    # rules-only requests apply immediately, no confirmation
    j = (await revise(client, pid, "louder music", dryRun=True)).json()
    assert j["needsConfirmation"] is False


@pytest.mark.slow
async def test_confirming_applies_exactly_the_shown_plan(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    set_provider(LiveAI(replies=['{"actions":[{"action":"speed","scope":"last","factor":0.5}],"unclear":""}']))
    shown = (await revise(client, pid, "make the ending dramatic")).json()
    set_provider(NoAI())  # the model is not consulted again, so what runs is what the user saw
    r = await revise(client, pid, "make the ending dramatic", confirmedActions=shown["actions"])
    j = r.json()
    assert r.status_code == 200 and j["needsConfirmation"] is False and j["job"]["type"] == "render"
    done, _ = await wait_job(client, pid, j["job"]["id"])
    assert done["status"] == "completed"
    assert (await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]["segments"][-1]["speed"] == 0.5


async def test_a_busy_project_is_not_changed(client, db, media_dir):
    pid, tl = await seeded(client, db, media_dir)
    await db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"status": "processing"}})
    r = await revise(client, pid, "remove the first clip")
    assert r.status_code == 409 and r.json()["error"]["code"] == "PROJECT_BUSY"
    assert len((await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]["segments"]) == len(tl.segments)


# ------------------------------------------------------------------ colour, on-screen text, pans, confirmation
def test_new_phrases_become_validated_actions():
    from app.models.timeline import Segment, TextOverlay, Timeline
    from app.video.timeline_ops import OpContext, apply_operations

    segs = [Segment(id=f"s{i}", clip_id="c", video="c.mp4", source_start=0, source_end=2, timeline_start=i * 2, timeline_end=(i + 1) * 2) for i in range(3)]
    tl = Timeline(duration=6, segments=segs, overlays=[TextOverlay(text="Hook", start=0.3, end=2, role="hook"),
                                                        TextOverlay(text="Benefit", start=2.5, end=4, role="benefit")])  # fmt: skip
    acts, unknown = rv.parse_rules("warmer colours, change the CTA to Shop Now, use pan effects, less text, make cuts faster")
    assert not unknown
    assert [a.kind for a in acts] == ["grade", "cta", "effect", "text_less", "pace"]
    ops_, notes, applied = rv.actions_to_ops(acts, tl)
    out = apply_operations(tl, ops_, OpContext(clip_durations={"c": 30.0}))
    assert out.color_grade == "warm"
    assert [s.effect for s in out.segments] == ["pan_left", "pan_right", "pan_left"]
    assert [(o.role, o.text) for o in out.overlays] == [("hook", "Hook"), ("cta", "Shop Now")]  # the benefit line went, the CTA arrived
    # a confirmed plan round-trips (the client's copy is re-validated)
    again = rv.actions_from_dicts([a.to_dict() for a in acts], 3)
    assert [a.kind for a in again] == ["grade", "cta", "effect", "text_less", "pace"] and again[2].value == "pan"


def test_destructive_changes_are_marked():
    acts, _ = rv.parse_rules("remove the first clip, no text, louder music")
    assert {a.kind for a in acts if a.kind in rv.DESTRUCTIVE_KINDS} == {"delete", "text_off"}


def test_the_ai_is_told_what_each_shot_shows():
    from app.models.timeline import Segment, Timeline

    tl = Timeline(duration=4, segments=[Segment(clip_id="a", video="a.mp4", source_start=0, source_end=2, timeline_start=0, timeline_end=2),
                                        Segment(clip_id="b", video="b.mp4", source_start=0, source_end=2, timeline_start=2, timeline_end=4)])  # fmt: skip
    s = rv.summary_for_ai(tl, {}, {"b": "a gold ring on velvet"})
    assert "shows" not in s["shots"][0] and s["shots"][1]["shows"] == "a gold ring on velvet"
    assert "pan_left" in rv.system_prompt() and "text_less" in rv.system_prompt()  # built from the registries


def test_the_new_camera_effects_can_be_asked_for_in_words():
    cases = {"add camera shake on the last shot": ("shake", "last"), "make it black and white": ("black_white", "all"),
             "crash zoom on the first clip": ("crash_zoom", "first"), "ken burns on every shot": ("ken_burns", "all"),
             "gentle roll on shot 2": ("roll", "shot")}  # fmt: skip
    for text, (effect, scope) in cases.items():
        acts, unknown = rv.parse_rules(text)
        assert not unknown and acts[0].kind == "effect" and acts[0].value == effect and acts[0].scope == scope, text


# ------------------------------------------------------------------ on-screen text in any language, exactly as typed
_MR = "बाप्पा गेले… पण मन अजूनही त्यांच्यातच आहे"


@pytest.mark.parametrize("request_text", [
    f"{_MR} 🥹❤️ add this text", f"add this text {_MR} 🥹❤️", f"add this text: {_MR}", f'add text "{_MR}"',
    f"{_MR} हा मजकूर टाका", f"हा टेक्स्ट टाका: {_MR}",
])  # fmt: skip
def test_marathi_text_is_used_exactly_as_typed(request_text):
    from app.revise.actions import parse_rules

    acts, unknown = parse_rules(request_text)
    assert [a.kind for a in acts] == ["hook_text"] and not unknown
    assert acts[0].value.replace(" 🥹❤️", "") == _MR


def test_text_requests_in_english_and_hindi_and_mixed_with_other_changes():
    from app.revise.actions import parse_rules

    acts, _ = parse_rules("ये लिखो: बप्पा चले गए… पर दिल अभी भी उन्हीं में है")
    assert acts[0].value == "बप्पा चले गए… पर दिल अभी भी उन्हीं में है"
    acts, _ = parse_rules("add this text Bappa left... but my heart is still with him")
    assert acts[0].value == "Bappa left... but my heart is still with him"
    acts, _ = parse_rules(f"add this text {_MR} and make the music louder")
    assert [a.kind for a in acts] == ["hook_text", "music_volume"] and acts[0].value == _MR
    acts, _ = parse_rules(f"add this text at the end: {_MR}")
    assert acts[0].kind == "cta" and acts[0].value == _MR
    for plain in ("add captions", "remove the text", "make the music louder", "add this text and make it bigger"):
        assert all(a.kind not in ("hook_text", "cta") for a in parse_rules(plain)[0]), plain


def test_the_ai_may_not_rewrite_the_users_words():
    from app.revise.actions import parse_ai_actions

    req = f"{_MR} 🥹❤️"
    ok, _ = parse_ai_actions({"actions": [{"action": "hook_text", "value": _MR}]}, 5, set(), request_text=req)
    assert ok and ok[0].value == _MR
    bad, dropped = parse_ai_actions({"actions": [{"action": "hook_text", "value": "दलृती दलृती"}]}, 5, set(), request_text=req)
    assert not bad and "changed your words" in dropped[0]


def test_emoji_are_left_out_of_video_text_and_the_user_is_told():
    from app.revise.actions import Action, describe
    from app.video.overlays import tidy_text

    assert tidy_text(f"{_MR} 🥹❤️") == _MR
    assert "emoji are left out" in describe(Action("hook_text", value=f"{_MR} 🥹❤️"))
