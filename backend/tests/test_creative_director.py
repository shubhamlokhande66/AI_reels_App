"""Phase 2.3-2.5: the project brief, the Creative Plan, the three concept directions and the hook engine."""

from __future__ import annotations

import json

import pytest

from app.ai.provider import set_provider
from app.ai.reel_director import ReelDirectorPlan, build_request
from app.ai.understanding import ClipSemantic
from app.director.brief import infer_brief
from app.director.creative import DIRECTIONS, DirectorConcept, draft_plan, merge_ai, story_for
from app.director.hooks import HOOK_TYPES, MAX_HOOKS, generate_hooks
from app.director.music_map import build_music_map
from app.models.analysis import Moment, UsableWindow
from app.schemas.project import ProjectSettings
from tests.test_ai import FakeProvider
from tests.test_jobs_api import make_project, wait_job
from tests.test_timeline import make_audio, make_clip


@pytest.fixture(autouse=True)
def _reset():
    yield
    set_provider(None)


def _clips(n=4, category=None):
    out = []
    for i in range(n):
        c = make_clip(f"id{i}", dur=6.0, motion=0.2 + 0.18 * i, sig_bin=i * 5)
        for w in c.analysis.windows:
            w.shot_size, w.composition, w.subject = ("close", 0.8, 0.85) if i % 2 == 0 else ("wide", 0.5, 0.2)
        c.analysis.moments = [Moment(t=2.0 + i * 0.5, kind=("reveal", "action_peak", "face_appears", "subject_close")[i % 4], score=0.8)]
        if category:
            c.semantic = ClipSemantic(clip_id=c.clip_id, category=category, importance=0.6)
        out.append(c)
    return out


# ---------------------------------------------------------------------- brief
def test_brief_uses_what_was_given_and_says_what_it_inferred():
    s = ProjectSettings(brief="Luxury gold rings for young women", duration=20, cta_text="", style="auto")
    b = infer_brief(s, {"name": "NAMORA", "cta": "Shop Now"}, ["jewelry", "jewelry", "other"])
    assert (b.platform, b.duration, b.objective, b.content_type) == ("instagram_reels", 20.0, "product_showcase", "jewelry")
    assert (b.audience, b.style, b.cta, b.brand) == ("young_women", "luxury", "Shop Now", "NAMORA")
    assert "objective" in b.inferred and "audience" not in b.inferred and "cta" not in b.inferred and "style" not in b.inferred
    # nothing given: everything has a sensible default, and is marked as a guess
    bare = infer_brief(ProjectSettings(style="auto"), None, [])
    assert bare.objective == "engagement" and bare.audience == "general" and {"objective", "audience", "style", "cta", "tone"} <= set(bare.inferred)
    # the person's explicit fields win
    own = infer_brief(ProjectSettings(objective="tutorial", audience="students", cta_text="Follow"), None, ["food"])
    assert (own.objective, own.audience, own.cta) == ("tutorial", "students", "Follow") and "objective" not in own.inferred


# ---------------------------------------------------------------------- hooks
def test_hook_engine_offers_up_to_five_typed_scored_alternatives():
    clips = _clips(5, category="jewelry")
    hooks = generate_hooks(clips, "gold rings", hook_text="Wait for it")
    assert 1 <= len(hooks) <= MAX_HOOKS
    assert hooks == sorted(hooks, key=lambda h: -h.hook_score)
    for h in hooks:
        assert h.type in HOOK_TYPES and 0 <= h.clarity <= 1 and 0 <= h.curiosity <= 1 and 0 <= h.visual_strength <= 1
        assert 1.0 - 1e-6 <= h.end - h.start <= 2.5 + 1e-6
        w = clips[int(h.clip_id[2:])].analysis.windows[0]
        assert w.start <= h.start and h.end <= w.end  # inside usable footage
        d = h.to_doc()
        assert {"hookScore", "clarity", "curiosity", "visualStrength", "type", "reason"} <= set(d)
    assert len({h.type for h in hooks}) >= 2  # real alternatives, not five of the same kind
    assert sum(1 for h in hooks if h.clip_id == hooks[0].clip_id) <= 2
    assert any(h.type == "product_reveal" for h in hooks)  # a product clip's reveal moment is offered as one
    assert any(h.type == "text_hook" and h.text == "Wait for it" for h in generate_hooks(clips, "", hook_text="Wait for it", k=8))


# ---------------------------------------------------------------------- creative plan
def test_story_follows_the_content_and_the_footage():
    food = infer_brief(ProjectSettings(duration=30), None, ["food"])
    assert story_for(food, 12, has_face=True)[-1] == "reaction"
    assert "reaction" not in story_for(food, 12, has_face=False)  # no face, no reaction shot
    travel = infer_brief(ProjectSettings(duration=30), None, ["travel"])
    assert story_for(travel, 12, False)[0] == "location_hook"
    short = story_for(infer_brief(ProjectSettings(duration=5, cta_text="Shop now"), None, ["product"]), 3, False)
    assert len(short) <= 3 and short[0] == "hook"


def test_the_three_concepts_really_differ():
    clips = _clips(5, category="jewelry")
    audio = make_audio(duration=30, loud_from=12, drops=(12.0,))
    mm = build_music_map(audio, 0.0, 20.0)
    brief = infer_brief(ProjectSettings(duration=20, cta_text="Shop now"), {"name": "NAMORA"}, ["jewelry"])
    hooks = generate_hooks(clips, "")
    plans = {d: draft_plan(brief, hooks, mm, direction=d) for d in DIRECTIONS}
    for f in ("pacing", "music_interpretation", "text_strategy", "effects_strategy", "concept"):
        assert len({getattr(p, f) for p in plans.values()}) == 3, f  # different on every axis that matters, not just colour
    assert {p.direction for p in plans.values()} == {"viral", "cinematic", "premium"}
    assert all(p.hook and p.story and p.ending for p in plans.values())
    assert plans["premium"].hook["type"] in DIRECTIONS["premium"].hook_types or plans["premium"].hook["type"] == hooks[0].type
    # the AI's concept wins where it answered; the hook is the shot actually used
    final = merge_ai(plans["viral"], DirectorConcept(concept="Gold Rush", story=["hook", "reveal", "cta"]), {"clipId": "id2", "start": 1.0})
    assert final.concept == "Gold Rush" and final.story == ["hook", "reveal", "cta"] and final.hook["clipId"] == "id2" and final.source == "ai"
    assert final.pacing == plans["viral"].pacing  # not answered -> the draft's


def test_the_ai_receives_the_brief_the_direction_and_typed_openings():
    clips = _clips(4, category="jewelry")
    audio = make_audio(duration=30)
    mm = build_music_map(audio, 0.0, 12.0)
    brief = infer_brief(ProjectSettings(duration=12), {"name": "NAMORA"}, ["jewelry"])
    hooks = generate_hooks(clips, "")
    draft = draft_plan(brief, hooks, mm, direction="premium")
    facts, _ = build_request(clips, audio, mm, 0.0, 12.0, {"luxury": "x"}, brief="", language="en", style_hint=None, captions=False,
                             cta="", hook="", pace="balanced", project_brief=brief.for_ai(), creative=draft.model_dump(), hooks=hooks,
                             brand={"name": "NAMORA", "tone": "premium"})  # fmt: skip
    assert facts["brief"]["brand"] == "NAMORA" and "inferred" in facts["brief"]
    assert facts["creative_direction"]["direction"] == "premium" and facts["brand"]["tone"] == "premium"
    assert facts["openings"] and {"type", "clarity", "curiosity", "visual_strength"} <= set(facts["openings"][0])
    assert "concept" in facts["rules"]
    # the answer may carry a concept, and older answers without one still validate
    p = ReelDirectorPlan.model_validate({"style": "luxury", "grade": "luxury", "shots": [], "concept": {"concept": "Luxury Reveal", "story": ["hook"]}})
    assert p.concept.concept == "Luxury Reveal"
    assert ReelDirectorPlan.model_validate({"style": "luxury", "grade": "luxury", "shots": []}).concept is None


# ---------------------------------------------------------------------- pipeline
@pytest.mark.slow
async def test_every_reel_has_a_brief_and_a_creative_plan(client, media_dir):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_portrait.mp4"], duration=5)
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    proj = (await client.get(f"/api/projects/{pid}")).json()
    tl, rp = proj["timeline"], proj["reelPlan"]
    assert tl["brief"]["platform"] == "instagram_reels" and tl["creativePlan"]["concept"] and tl["creativePlan"]["source"] == "rules"
    assert tl["creativePlan"]["hook"]["clipId"] == tl["segments"][0]["clipId"]  # the plan's hook is the opening really used
    assert rp["creativePlan"] == tl["creativePlan"] and rp["brief"] == tl["brief"] and 1 <= len(rp["hooks"]) <= 5


@pytest.mark.slow
async def test_ai_director_answers_the_concept_in_the_same_call(client, media_dir):
    reply = {"style": "cinematic", "grade": "warm", "reason": "calm story", "title": "Golden", "description": "A calm edit.",
             "hashtags": ["calm"], "concept": {"concept": "Golden Hour Story", "logline": "A calm walk into the light.", "hook_type": "visual_surprise",
                         "story": ["hook", "journey", "reveal"], "pacing": "slow"},
             "shots": [{"clip": "c1", "source_start": 0.5, "source_end": 3.0, "duration": 2.5},
                       {"clip": "c2", "source_start": 0.5, "source_end": 3.0, "duration": 2.5}]}  # fmt: skip
    fake = FakeProvider([json.dumps(reply)])
    set_provider(fake)
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_portrait.mp4"], ai=True, duration=5)
    job = (await client.post(f"/api/projects/{pid}/generate")).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    director_calls = [c for c in fake.calls if c[0].startswith("You are the creative director")]
    assert len(director_calls) == 1  # the concept costs no extra call (a reviewer call may follow only for a low score)
    sent = json.loads(director_calls[0][1].split("\n")[0])
    assert {"brief", "creative_direction", "openings"} <= set(sent)
    cp = (await client.get(f"/api/projects/{pid}")).json()["timeline"]["creativePlan"]
    assert cp["concept"] == "Golden Hour Story" and cp["story"] == ["hook", "journey", "reveal"] and cp["source"] == "ai"


@pytest.mark.slow
async def test_three_concepts_as_versions_and_every_generation_is_logged(client, media_dir):
    pid = await make_project(client, media_dir, videos=["clip_a.mp4", "clip_d.mp4", "clip_portrait.mp4"], duration=5)
    job = (await client.post(f"/api/projects/{pid}/variations", json={"strategies": ["viral", "cinematic", "premium"]})).json()
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    versions = (await client.get(f"/api/projects/{pid}/renderings")).json()
    assert sorted(v["label"] for v in versions) == ["Version A: Viral", "Version B: Cinematic", "Version C: Premium"]
    gens = (await client.get(f"/api/projects/{pid}/generations")).json()
    assert len(gens) == 1 and gens[0]["type"] == "variations"
    assert sorted(v["strategy"] for v in gens[0]["variants"]) == ["cinematic", "premium", "viral"]
    assert len({v["concept"] for v in gens[0]["variants"]}) == 3  # three different concepts, not three colourings


def test_each_concept_opens_differently_and_has_its_own_shot_order():
    from app.director.creative import hooks_for

    clips = _clips(5, category="jewelry")
    hooks = generate_hooks(clips, "")
    opened: set[str] = set()
    firsts = []
    for d in ("viral", "cinematic", "premium"):
        mine = hooks_for(d, hooks, opened)
        assert sorted(id(h) for h in mine) == sorted(id(h) for h in hooks)  # same openings, its own first
        firsts.append(mine[0])
        opened.add(mine[0].clip_id)
    assert len({h.clip_id for h in firsts}) == 3  # three versions, three different opening shots
    brief = infer_brief(ProjectSettings(duration=20), None, ["jewelry"])
    orders = {d: draft_plan(brief, hooks, None, direction=d).shot_order for d in DIRECTIONS}
    assert len(set(orders.values())) == 3 and all(orders.values())


def test_a_version_that_repeats_an_earlier_opening_gets_its_own():
    from app.director.creative import distinct_opening, hooks_for
    from app.styles import get_style
    from app.video.timeline import build_timeline

    clips = _clips(5, category="jewelry")
    tl = build_timeline(make_audio(duration=40), clips, 12.0, get_style("luxury"), seed=2)
    opened = {tl.segments[0].clip_id}  # an earlier version already opens on this clip
    own = hooks_for("premium", generate_hooks(clips, ""), opened)[0]
    note = distinct_opening(tl, [own], opened, clips)
    assert note and tl.segments[0].clip_id == own.clip_id and tl.segments[0].clip_id not in opened
    assert distinct_opening(tl, [own], set(), clips) is None  # nothing to do when the opening is already unique


def test_the_opening_trades_places_when_its_footage_is_already_used():
    from app.director.creative import distinct_opening, hooks_for
    from app.styles import get_style
    from app.video.timeline import build_timeline

    clips = _clips(3, category="jewelry")
    for c in clips:  # short clips: every good moment ends up in the Reel
        c.analysis.windows[0].end = 2.5
        c.analysis.metadata.duration = 2.5
    tl = build_timeline(make_audio(duration=40), clips, 7.0, get_style("luxury"), seed=2)
    opened = {tl.segments[0].clip_id}
    own = hooks_for("premium", generate_hooks(clips, ""), opened)[0]
    cuts = [(s.timeline_start, s.timeline_end) for s in tl.segments]
    note = distinct_opening(tl, [own], opened, clips)
    if note:  # changed: the new opening is a different clip, the cuts did not move, and no moment is shown twice
        assert tl.segments[0].clip_id not in opened and [(s.timeline_start, s.timeline_end) for s in tl.segments] == cuts
        for i, s in enumerate(tl.segments):
            for j, o in enumerate(tl.segments):
                if i < j and s.clip_id == o.clip_id:
                    assert min(s.source_end, o.source_end) - max(s.source_start, o.source_start) <= 0.1 + 1e-6


def test_cinematic_plays_in_filming_order_on_the_same_cuts():
    from app.director.creative import story_order
    from app.styles import get_style
    from app.video.timeline import build_timeline

    clips = _clips(5)
    for c in clips:
        c.analysis.windows[0].end = c.analysis.metadata.duration = 12.0
    tl = build_timeline(make_audio(duration=40), clips, 14.0, get_style("viral"), seed=4)
    mid = tl.segments[1:-1]
    mid.reverse()  # deliberately out of story order
    tl.segments[1:-1] = [s.model_copy(update={"timeline_start": o.timeline_start, "timeline_end": o.timeline_end})
                         for s, o in zip(mid, tl.segments[1:-1])]  # fmt: skip
    cuts = [(s.timeline_start, s.timeline_end) for s in tl.segments]
    first, last = tl.segments[0].model_copy(), tl.segments[-1].model_copy()
    order = [c.clip_id for c in clips]
    note = story_order(tl, order, clips)
    assert note and [(s.timeline_start, s.timeline_end) for s in tl.segments] == cuts
    keys = [(order.index(s.clip_id), s.source_start) for s in tl.segments[1:-1]]
    assert keys == sorted(keys)  # filming order between the opening and the ending
    assert tl.segments[0].clip_id == first.clip_id and tl.segments[-1].clip_id == last.clip_id
    assert story_order(tl, order, clips) is None  # already in order: nothing to do
    tl.segments[2].locked = True
    tl.segments[1:-1] = list(reversed(tl.segments[1:-1]))
    assert story_order(tl, order, clips) is None  # a hand-edited shot is never moved
