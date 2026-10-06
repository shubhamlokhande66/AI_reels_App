"""Learning system (feedback -> personal director profile), privacy (delete media after rendering), and the AI
Creative Director's outputs on a real generated Reel (quality review, ranked openings, a reason for every shot)."""

from __future__ import annotations

import pytest

from app.models.timeline import Segment, Timeline, Transition
from app.services.feedback import apply_profile, build_profile, edit_facts, events_from_ops
from app.styles import get_style
from app.video.timeline_ops import Delete, Replace, SetEffect, SetTransition
from tests.test_jobs_api import make_project, wait_job


def _tl(n=6, effect="punch", transition="dissolve"):
    segs = []
    for i in range(n):
        segs.append(Segment(id=f"s{i}", clip_id=f"c{i}", video=f"c{i}.mp4", source_start=0, source_end=1, timeline_start=i,
                            timeline_end=i + 1, effect=effect, transition_in=Transition(type="cut" if i == 0 else transition, duration=0 if i == 0 else 0.2)))  # fmt: skip
    return Timeline(duration=n, segments=segs)


def test_manual_edits_become_taste_events():
    tl = _tl()
    ev = events_from_ops(tl, [Replace(segment_id="s0", clip_id="c3"), Delete(segment_id="s2"), SetEffect(segment_id="s1", effect="none"),
                              SetTransition(segment_id="s3", transition="cut")])  # fmt: skip
    assert [e for e, _ in ev] == ["rejected_opening", "removed_shot", "removed_effect", "removed_transition"]


def test_profile_needs_evidence_then_learns_preferences():
    assert not build_profile([]).ready
    accepted = {"event": "accepted", "facts": edit_facts(_tl(n=12, transition="cut"))}
    events = [accepted, accepted] + [{"event": "removed_transition", "facts": {}}] * 2 + [{"event": "rejected_opening", "facts": {}}] * 2
    p = build_profile(events)
    assert p.ready and p.evidence == 6
    assert p.preferences["transitions"] == "minimal" and p.preferences["hook"] == "aggressive"
    assert p.preferences["pace"] == "fast" and p.preferences["avgShotSeconds"] == 1.0  # 12 shots in 12 s


def test_profile_only_changes_what_was_left_on_auto():
    profile = build_profile([{"event": "removed_transition", "facts": {}}] * 3 + [{"event": "rejected_opening", "facts": {}}] * 2).to_doc()
    style = get_style("cinematic")
    tuned, notes = apply_profile(style, "auto", profile)
    assert tuned.max_transition_ratio <= 0.15 < style.max_transition_ratio and tuned.hook_priority >= 0.6 and notes
    off = {**profile, "enabled": False}
    assert apply_profile(style, "auto", off) == (style, [])


@pytest.mark.slow
async def test_director_review_feedback_profile_and_privacy_end_to_end(client, media_dir, storage):
    pid = await make_project(client, media_dir, duration=8, style="viral", deleteMediaAfterRender=True)
    job = (await client.post(f"/api/projects/{pid}/generate", json={})).json()
    assert "reviewing" in [s["name"] for s in job["stages"]]
    done, _ = await wait_job(client, pid, job["id"])
    assert done["status"] == "completed", done["error"]
    proj = (await client.get(f"/api/projects/{pid}")).json()
    plan = proj["reelPlan"]
    review = plan["review"]
    assert 0 <= review["overallScore"] <= 100 and {"hook", "pacing", "story", "diversity"} <= set(review["categories"])
    assert all({"timestamp", "problem", "severity"} <= set(i) for i in review["issues"])
    assert 1 <= len(plan["hookCandidates"]) <= 3
    assert all(s["why"] for s in plan["shots"])  # the director explains every shot

    # privacy: the uploads are gone, the Reel is still there, and a new render says why it cannot run
    media = proj["videos"] + ([proj["audio"]] if proj.get("audio") else [])
    assert not list(storage.list(f"projects/{pid}/input"))
    out = (await client.get(f"/api/projects/{pid}/output")).json()
    assert (await client.get(f"/api/projects/{pid}/renderings/{out['id']}/file")).status_code == 200
    r = await client.post(f"/api/projects/{pid}/generate", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "MEDIA_PURGED"
    assert media

    # feedback -> profile
    prof = (await client.post(f"/api/projects/{pid}/feedback", json={"verdict": "accepted"})).json()
    assert prof["counts"]["accepted"] == 1 and not prof["ready"]
    for _ in range(2):
        await client.post(f"/api/projects/{pid}/feedback", json={"verdict": "rejected", "reason": "opening"})
    prof = (await client.get("/api/director/profile")).json()
    assert prof["ready"] and prof["preferences"]["hook"] == "aggressive"
    assert (await client.put("/api/director/profile", json={"enabled": False})).json()["enabled"] is False
    assert (await client.delete("/api/director/profile")).json()["evidence"] == 0
