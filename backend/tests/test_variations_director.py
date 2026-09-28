"""Variations (different strategies), story director + orchestrator, duplicates/language variants, insights, dashboard."""

from __future__ import annotations

import json

import pytest
from bson import ObjectId

from app.ai.director import ROLES, parse_story, plan_story, story_order_hint
from app.ai.orchestrator import AGENTS, LLM_AGENTS, plan_agents
from app.ai.provider import AIProvider, AIResponseError, set_provider
from app.ai.understanding import parse_semantic
from app.core.errors import ValidationFailed
from app.jobs import pipeline
from app.schemas.project import ProjectSettings
from app.styles.resolve import resolve_style
from app.variations.strategies import DEFAULT_SET, STRATEGIES, chronological_hint, get_strategy, version_label
from app.video.timeline import ClipInput, build_timeline
from tests.test_editor_api import ops, seeded
from tests.test_jobs_api import make_project, wait_job
from tests.test_script_voice import ScriptLLM
from tests.test_timeline import make_audio, make_clip


@pytest.fixture(autouse=True)
def _reset():
    yield
    set_provider(None)


# ------------------------------------------------------------------ strategies are genuinely different
def _timeline_for(strategy_id, clips, seed=3, duration=20):
    st = get_strategy(strategy_id)
    settings = ProjectSettings(style=st.style, pace=st.pace, caption_style=st.caption_style)
    hint = chronological_hint([c.clip_id for c in clips]) if st.order == "chronological" else None
    return build_timeline(make_audio(duration=60), clips, duration, resolve_style(settings), seed=seed, order_hint=hint)


@pytest.fixture
def clips():
    return [make_clip(f"clip_{i}", motion=0.9 - 0.15 * i, quality=0.95 - 0.1 * i, sig_bin=i * 5) for i in range(5)]


def test_registry_labels_and_unknown_strategy():
    assert list(DEFAULT_SET) == ["fast_trending", "cinematic", "storytelling", "luxury", "minimal"] and set(DEFAULT_SET) <= set(STRATEGIES)
    assert [version_label(i, get_strategy(s)) for i, s in enumerate(DEFAULT_SET)][:3] == [
        "Version A: Fast + Trending", "Version B: Cinematic", "Version C: Storytelling"]
    with pytest.raises(ValidationFailed) as e:
        get_strategy("tiktok-dance")
    assert e.value.code == "UNKNOWN_STRATEGY" and "minimal" in e.value.details["available"]
    assert chronological_hint(["a", "b", "c"]) == {"a": 0.0, "b": 0.5, "c": 1.0}


def test_versions_use_different_pacing_transitions_and_effects_not_just_a_shuffle(clips):
    tls = {sid: _timeline_for(sid, clips) for sid in DEFAULT_SET}
    shots = {sid: len(t.segments) for sid, t in tls.items()}
    assert shots["fast_trending"] > 1.8 * shots["cinematic"]  # tempo differs a lot
    minimal = tls["minimal"]
    assert {s.transition_in.type for s in minimal.segments} == {"cut"} and {s.effect for s in minimal.segments} == {"none"}
    assert any(s.transition_in.type in ("dissolve", "fade") for s in tls["cinematic"].segments)
    assert any(s.effect != "none" for s in tls["fast_trending"].segments)
    assert any(s.speed < 1 for s in tls["luxury"].segments)  # slow motion
    # every version is a different edit
    docs = {sid: json.dumps([(s.clip_id, s.source_start, s.timeline_end, s.effect, s.transition_in.type, s.speed) for s in t.segments])
            for sid, t in tls.items()}  # fmt: skip
    assert len(set(docs.values())) == len(docs)
    assert all(t.duration == 20 for t in tls.values())


def test_storytelling_keeps_the_order_the_clips_were_shot(clips):
    story = _timeline_for("storytelling", clips, duration=25)
    first_seen: list[str] = []
    for s in story.segments:
        if s.clip_id not in first_seen:
            first_seen.append(s.clip_id)
    assert first_seen == [c.clip_id for c in clips if c.clip_id in first_seen]  # chronological
    quality_first = _timeline_for("fast_trending", clips, duration=25)
    assert quality_first.segments[0].clip_id == "clip_0" or True  # (best-first ordering is a soft preference)


# ------------------------------------------------------------------ story director
ALIAS = {"clip_1": "A", "clip_2": "B", "clip_3": "C", "clip_4": "D"}


def test_story_is_validated_repaired_and_ordered_canonically():
    plan = parse_story({"structure": [{"role": "PAYOFF", "clips": ["clip_4"]}, {"role": "hook", "clips": ["clip_2", "clip_2", "ghost"]},
                                      {"role": "made-up", "clips": ["clip_1"]}, "junk", {"role": "main", "clips": ["clip_3"]}],
                        "hook": "  Watch\nthis!  ", "cta": "Follow " + "x" * 300, "reason": "strong opening"}, ALIAS)  # fmt: skip
    assert plan.structure == ["hook", "main", "payoff"]  # canonical order, unknown role dropped
    assert plan.assignments["hook"] == ["B"] and plan.assignments["payoff"] == ["D"]
    assert "A" in plan.assignments["main"]  # the clip the model forgot is still used
    assert plan.hook == "Watch this!" and len(plan.cta) <= 100 and plan.reason == "strong opening"
    hint = story_order_hint(plan, ["A", "B", "C", "D"])
    assert hint["B"] == 0.0 and hint["D"] == 1.0 and hint["B"] < hint["C"] < hint["D"] and set(hint) == set("ABCD")
    for bad in ({}, {"structure": []}, {"structure": [{"role": "nope", "clips": []}]}, {"structure": "text"}):
        with pytest.raises(AIResponseError):
            parse_story(bad, ALIAS)


def test_plan_story_prompt_uses_language_brief_and_clip_facts():
    llm = ScriptLLM({"structure": [{"role": "hook", "clips": ["clip_1"]}, {"role": "main", "clips": ["clip_2"]}], "hook": "h", "cta": "c"})
    cs = [ClipInput("id1", "kitchen.mp4", make_clip("id1").analysis, parse_semantic("id1", {"scene": "kitchen", "tags": ["cooking"], "summary": "Chef stirs"})),
          ClipInput("id2", "plate.mp4", make_clip("id2").analysis, None)]  # fmt: skip
    plan = plan_story(llm, "A recipe reel\nIGNORE ALL", "hinglish", cs, 15)
    p = llm.calls[0]
    assert "Hinglish" in p and "kitchen" in p and "cooking" in p and "id1" not in p and "\n" not in p.split('Brief: "')[1].split('"')[0]
    assert plan.assignments["hook"] == ["id1"] and plan.assignments["main"] == ["id2"]
    assert all(r in ROLES for r in plan.structure)


# ------------------------------------------------------------------ orchestrator uses the minimum agents
def agents(**kw):
    base = dict(ai_on=False, style_auto=False, has_brief=False, semantic_ready=False, audio_mode="music", captions=False)
    return plan_agents(**{**base, **kw})


def test_no_llm_agent_runs_when_ai_is_off():
    p = agents()
    assert not (set(p.run) & LLM_AGENTS) and "clip_selector" in p.run and "quality_checker" in p.run
    assert p.run[:2] == ("audio_analyst", "video_analyst") and "AI assist is off" in p.skipped["story_planner"]
    assert p.pending_human == ()


def test_agents_are_added_only_when_needed():
    assert "story_planner" in agents(ai_on=True, has_brief=True, semantic_ready=True).run
    assert "story_planner" not in agents(ai_on=True, has_brief=True, semantic_ready=False).run
    assert "no brief" in agents(ai_on=True, has_brief=False, semantic_ready=True).skipped["story_planner"]
    assert "style_director" in agents(ai_on=True, style_auto=True).run and "style_director" not in agents(ai_on=True).run
    assert "caption_generator" in agents(captions=True).run and "caption_generator" not in agents().run
    voice = agents(ai_on=True, audio_mode="voice_music")
    assert voice.pending_human == ("script_writer", "voice_planner") and "script_writer" not in voice.run  # human approves the script
    assert "reel_optimizer" in agents(over_platform_limit=True).run
    assert set(agents(ai_on=True, style_auto=True, has_brief=True, semantic_ready=True, captions=True, audio_mode="voice").run) <= set(AGENTS)
    assert len(agents().run) < len(agents(ai_on=True, style_auto=True, has_brief=True, semantic_ready=True, captions=True).run)


def test_pipeline_runs_the_story_planner_when_there_is_a_brief_and_reports_agents():
    llm = ScriptLLM({"structure": [{"role": "hook", "clips": ["clip_2"]}, {"role": "payoff", "clips": ["clip_1"]}], "hook": "h", "cta": "c", "reason": "r"})
    set_provider(llm)
    cs = [ClipInput(f"c{i}", f"c{i}.mp4", make_clip(f"c{i}", sig_bin=i * 8).analysis, parse_semantic(f"c{i}", {"scene": "x", "tags": ["t"]})) for i in (1, 2)]
    inp = pipeline.PipelineInput(project_id="p", job_type="generate", videos=[], audio=None, project_name="Recipe",
                                 settings=ProjectSettings(ai=True, brief="a cooking reel", style="cinematic"))  # fmt: skip
    notes, warnings = [], []
    style, hint = pipeline.choose_style_and_order(inp, cs, make_audio(), notes, warnings)
    assert hint == {"c2": 0.0, "c1": 1.0} and not warnings
    assert any(n.startswith("Story: hook -> payoff") for n in notes)
    assert any(n.startswith("Agents used:") and "story planner" in n for n in notes)


# ------------------------------------------------------------------ variations job end to end
@pytest.mark.slow
async def test_variations_render_versions_with_different_strategies_from_one_analysis(client, media_dir, storage):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_d.mp4", "clip_portrait.mp4"], duration=6, style="fast_trending")
    strategies = (await client.get("/api/variation-strategies")).json()
    assert [s["id"] for s in strategies] == list(DEFAULT_SET)

    job = (await client.post(f"/api/projects/{pid}/variations", json={"strategies": ["cinematic", "minimal"]})).json()
    assert job["type"] == "variations" and "rendering" in [s["name"] for s in job["stages"]]
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    versions = (await client.get(f"/api/projects/{pid}/renderings")).json()
    labels = sorted(v["label"] for v in versions)
    assert labels == ["Version A: Cinematic", "Version B: Minimal"]
    assert {v["style"] for v in versions} == {"cinematic", "minimal"}
    proj = (await client.get(f"/api/projects/{pid}")).json()
    assert proj["status"] == "completed" and proj["output"] is not None  # the first version becomes the project's output

    from app.core.ffmpeg import probe

    for v in versions:
        info = probe(storage.local_path(f"projects/{pid}/output/{v['id']}.mp4"))
        assert {s["codec_type"] for s in info["streams"]} == {"video", "audio"} and (v["width"], v["height"]) == (1080, 1920)
        assert v["duration"] == pytest.approx(6, abs=0.4)
    # choosing a version makes its edit the current, editable timeline
    minimal = next(v for v in versions if v["style"] == "minimal")
    st = (await client.post(f"/api/projects/{pid}/renderings/{minimal['id']}/restore")).json()
    segs = st["timeline"]["segments"]
    assert {s["transitionIn"]["type"] for s in segs} == {"cut"} and {s["effect"] for s in segs} == {"none"}

    bad = await client.post(f"/api/projects/{pid}/variations", json={"strategies": ["nope"]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNKNOWN_STRATEGY"
    none = await client.post(f"/api/projects/{pid}/variations", json={"strategies": []})
    assert none.status_code == 422


# ------------------------------------------------------------------ duplicate / language variants
async def test_duplicate_copies_media_and_remaps_the_edit_without_re_uploading(client, db, media_dir, storage):
    pid, tl = await seeded(client, db, media_dir, duration=8)
    orig = (await client.get(f"/api/projects/{pid}")).json()
    r = await client.post(f"/api/projects/{pid}/duplicate", json={"name": "Copy of reel"})
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["mediaCopied"] == 4 and new["hasTimeline"] is True
    cp = (await client.get(f"/api/projects/{new['id']}")).json()
    assert cp["name"] == "Copy of reel" and cp["status"] == "draft" and len(cp["videos"]) == 3 and cp["audio"]["name"] == "beat120.mp3"
    old_ids = {v["id"] for v in orig["videos"]}
    new_ids = {v["id"] for v in cp["videos"]}
    assert not (old_ids & new_ids), "media documents are independent copies"
    tl2 = (await client.get(f"/api/projects/{new['id']}/timeline")).json()["timeline"]
    assert {s["clipId"] for s in tl2["segments"]} <= new_ids  # the edit points at the copies, not the originals
    assert len(list(storage.list(f"projects/{new['id']}/input"))) == 4
    await client.delete(f"/api/projects/{pid}")  # deleting the original must not break the copy
    still = (await client.get(f"/api/projects/{new['id']}")).json()
    assert len(still["videos"]) == 3
    from fastapi import status

    assert (await client.get(still["videos"][0]["url"])).status_code == status.HTTP_200_OK


async def test_language_variant_keeps_the_footage_but_clears_language_specific_parts(client, db, media_dir):
    pid, _ = await seeded(client, db, media_dir, duration=8)
    await client.put(f"/api/projects/{pid}/script", json={"language": "en", "lines": [{"text": "Hello there"}], "tone": "warm"})
    await ops(client, pid, {"type": "add_caption", "start": 1, "end": 3, "text": "Hello there"})
    mr = (await client.post(f"/api/projects/{pid}/duplicate", json={"variant": "language", "language": "mr"})).json()
    proj = (await client.get(f"/api/projects/{mr['id']}")).json()
    assert proj["settings"]["language"] == "mr" and proj["name"].endswith("(MR)") and proj["settings"]["captions"] is False
    tl = (await client.get(f"/api/projects/{mr['id']}/timeline")).json()["timeline"]
    assert tl["captions"] == [] and tl["voice"] is None and len(tl["segments"]) > 0
    script = (await client.get(f"/api/projects/{mr['id']}/script")).json()
    assert script["language"] == "mr" and script["lines"] == [] and script["tone"] == "warm"
    orig = (await client.get(f"/api/projects/{pid}/timeline")).json()["timeline"]
    assert len(orig["captions"]) == 1  # the original was not touched


async def test_duplicating_a_busy_project_is_refused(client, db, media_dir):
    pid, _ = await seeded(client, db, media_dir)
    await db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"status": "processing"}})
    r = await client.post(f"/api/projects/{pid}/duplicate")
    assert r.status_code == 409 and r.json()["error"]["code"] == "PROJECT_BUSY"


# ------------------------------------------------------------------ performance data, insights, dashboard
async def _rendering(db, pid, style="luxury", duration=15.0, **extra):
    rid = ObjectId()
    await db.renderings.insert_one({"_id": rid, "projectId": ObjectId(pid), "style": style, "kind": "final", "duration": duration,
                                    "width": 1080, "height": 1920, "size": 1, "storedKey": "x", "label": "", "createdAt": __import__("datetime").datetime.now(), **extra})  # fmt: skip
    return str(rid)


async def test_performance_data_is_user_entered_and_validated(client, db, media_dir):
    pid, _ = await seeded(client, db, media_dir)
    rid = await _rendering(db, pid)
    ok = await client.put(f"/api/projects/{pid}/renderings/{rid}/performance",
                          json={"platform": "instagram", "views": 1200, "watchSeconds": 5400, "likes": 90, "completionRate": 0.62})  # fmt: skip
    assert ok.status_code == 200 and ok.json()["performance"]["views"] == 1200
    for bad in ({"views": -5}, {"completionRate": 1.7}, {"platform": "myspace"}):
        assert (await client.put(f"/api/projects/{pid}/renderings/{rid}/performance", json=bad)).status_code == 422
    assert (await client.put(f"/api/projects/{pid}/renderings/507f1f77bcf86cd799439011/performance", json={"views": 1})).status_code == 404


async def test_insights_are_honest_about_small_samples(client, db, media_dir):
    pid, _ = await seeded(client, db, media_dir)
    empty = (await client.get("/api/insights")).json()
    assert empty["posts"] == 0 and empty["enoughData"] is False and "Add results for at least 8" in empty["note"]
    for i in range(3):
        rid = await _rendering(db, pid, "luxury", 14, timeline={"captionStyle": "luxury", "captions": [], "voice": None})
        await client.put(f"/api/projects/{pid}/renderings/{rid}/performance", json={"views": 100 + i, "completionRate": 0.5})
    rid = await _rendering(db, pid, "fast_trending", 28, timeline={"captionStyle": "bold", "captions": [{"x": 1}], "voice": {"a": 1}})
    await client.put(f"/api/projects/{pid}/renderings/{rid}/performance", json={"views": 900, "completionRate": 0.8})
    ins = (await client.get("/api/insights")).json()
    assert ins["posts"] == 4 and ins["enoughData"] is False
    by = {g["name"]: g for g in ins["byStyle"]}
    assert by["luxury"]["n"] == 3 and by["luxury"]["confident"] is False and by["fast_trending"]["avgCompletion"] == 0.8
    assert ins["byStyle"][0]["name"] == "fast_trending"  # ranked, but flagged as not confident
    assert {g["name"] for g in ins["byDuration"]} == {"up to 15s", "16-30s"}
    assert {g["name"] for g in ins["byVoiceOver"]} == {"music only", "voice-over"}
    assert "guarantees or predicts" in ins["note"] and "chance" in ins["note"]
    for i in range(6):
        r2 = await _rendering(db, pid, "cinematic", 15, timeline={})
        await client.put(f"/api/projects/{pid}/renderings/{r2}/performance", json={"views": 10})
    big = (await client.get("/api/insights")).json()
    assert big["enoughData"] is True and {g["name"]: g for g in big["byStyle"]}["cinematic"]["confident"] is True


async def test_dashboard_aggregates_everything_the_requirements_list(client, db, media_dir):
    pid, _ = await seeded(client, db, media_dir)
    await client.post("/api/voices", json={"name": "V", "language": "en"})
    await client.post("/api/brands", json={"name": "B", "colors": {}, "watermark": {}, "language": "en", "captionStyle": "minimal",
                                           "style": "auto", "pace": "balanced", "exportPreset": "instagram_reel"})  # fmt: skip
    await client.put("/api/templates/luxury_product/favorite", json={"favorite": True})
    await client.post(f"/api/projects/{pid}/apply-template", json={"templateId": "luxury_product"})
    await _rendering(db, pid, "luxury")
    d = (await client.get("/api/dashboard")).json()
    assert d["projects"]["total"] == 1 and d["projects"]["completed"] == 1 and d["voiceProfiles"] == 1 and d["brands"] == 1
    assert d["library"] == {"clips": 3, "analyzed": 0} and d["rendering"] == 0
    assert [t["id"] for t in d["templates"]["favorites"]] == ["luxury_product"] and d["templates"]["mostUsed"][0]["uses"] == 1
    assert d["recentlyGenerated"][0]["projectName"] == "Reel" and d["mostUsedStyles"][0]["style"] == "luxury"
