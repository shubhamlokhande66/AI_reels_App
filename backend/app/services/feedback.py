"""Learning system: structured, anonymous edit feedback and the personal director profile built from it.

What is stored: the kind of event (accepted, rejected opening, replaced clip, changed duration/style, removed effect
...) and a few numbers about the edit (shot length, transition share, style, duration). No file names, no text, no user
identity: there is one local user and nothing leaves the machine. No model is trained: the profile is plain statistics
over these events, and it only nudges the defaults the person left on "auto" (pace, transitions, effects, hook).
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from statistics import mean, median
from typing import Any

from bson import ObjectId

from app.core.database import get_db
from app.models.base import utcnow
from app.models.timeline import Timeline

log = logging.getLogger(__name__)

EVENTS = (
    "accepted", "rejected", "rejected_opening", "replaced_clip", "removed_shot", "changed_duration", "changed_style",
    "changed_pace", "removed_effect", "added_effect", "removed_transition", "added_transition", "changed_speed",
    "edited_text", "regenerated", "chose_concept",
)  # fmt: skip
CONCEPTS = ("viral", "cinematic", "premium")
REJECT_REASONS = ("opening", "pacing", "music", "clips", "text", "effects", "other")
MIN_EVIDENCE = 3  # events before the profile changes anything
PROFILE_KEY = "settings/director_profile.json"


def edit_facts(tl: Timeline) -> dict[str, Any]:
    """Numbers that describe an edit's taste (no names, no text)."""
    n = len(tl.segments)
    return {
        "avgShot": round(tl.duration / max(n, 1), 3), "shots": n, "duration": round(tl.duration, 2), "style": tl.style,
        "transitionRatio": round(sum(1 for s in tl.segments[1:] if s.transition_in.type != "cut") / max(n - 1, 1), 3),
        "effectRatio": round(sum(1 for s in tl.segments if s.effect != "none") / max(n, 1), 3), "texts": len(tl.overlays),
        "concept": (tl.creative_plan or {}).get("direction") if (tl.creative_plan or {}).get("direction") in CONCEPTS else None,
    }  # fmt: skip


async def record(project_id: Any, event: str, **facts: Any) -> None:
    """Store one event. Feedback must never break an edit, so failures are only logged."""
    if event not in EVENTS:
        return
    try:
        pid = project_id if isinstance(project_id, ObjectId) else ObjectId(str(project_id))
        clean = {k: v for k, v in facts.items() if isinstance(v, (int, float, str, bool)) or v is None}
        await get_db().feedback.insert_one({"projectId": pid, "event": event, "facts": clean, "at": utcnow()})
    except Exception as exc:  # noqa: BLE001
        log.info("feedback not recorded (%s): %s", event, exc)


def events_from_ops(tl: Timeline, ops: list) -> list[tuple[str, dict[str, Any]]]:
    """What a manual edit says about the person's taste."""
    out: list[tuple[str, dict[str, Any]]] = []
    by_id = {s.id: (i, s) for i, s in enumerate(tl.segments)}
    for op in ops:
        kind = getattr(op, "type", "")
        i, seg = by_id.get(getattr(op, "segment_id", ""), (None, None))
        if kind in ("replace", "delete"):
            if i == 0:
                out.append(("rejected_opening", {"how": kind}))
            else:
                out.append(("replaced_clip" if kind == "replace" else "removed_shot", {"position": i}))
        elif kind == "set_effect" and seg is not None:
            new = getattr(op, "effect", "none")
            if new == "none" and seg.effect != "none":
                out.append(("removed_effect", {"effect": seg.effect}))
            elif new != "none" and seg.effect == "none":
                out.append(("added_effect", {"effect": new}))
        elif kind == "set_transition" and seg is not None:
            new = getattr(op, "transition", "cut")
            if new == "cut" and seg.transition_in.type != "cut":
                out.append(("removed_transition", {"transition": seg.transition_in.type}))
            elif new != "cut" and seg.transition_in.type == "cut":
                out.append(("added_transition", {"transition": new}))
        elif kind == "set_speed":
            out.append(("changed_speed", {"speed": getattr(op, "speed", None)}))
        elif kind in ("add_caption", "update_caption", "delete_caption"):
            out.append(("edited_text", {"how": kind}))
    return out


async def record_ops(project_id: Any, tl: Timeline, ops: list) -> None:
    for event, facts in events_from_ops(tl, ops):
        await record(project_id, event, **facts)


async def record_settings_change(project_id: Any, before: dict[str, Any], after: dict[str, Any]) -> None:
    for key, event in (("duration", "changed_duration"), ("style", "changed_style"), ("pace", "changed_pace")):
        if key in after and after[key] is not None and before.get(key) != after[key]:
            await record(project_id, event, frm=before.get(key), to=after[key])


# ----------------------------------------------------------------------------- the profile
@dataclass
class DirectorProfile:
    ready: bool
    evidence: int
    preferences: dict[str, Any] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    enabled: bool = True

    def to_doc(self) -> dict[str, Any]:
        p = self.preferences
        summary = {"preferred_pacing": p.get("pace"), "transition_preference": p.get("transitions"), "style": p.get("style"),
                   "concept": p.get("concept"), "shot_range": p.get("shotRange")}  # fmt: skip
        return {"ready": self.ready, "enabled": self.enabled, "evidence": self.evidence, "minEvidence": MIN_EVIDENCE,
                "preferences": self.preferences, "counts": self.counts, "summary": {k: v for k, v in summary.items() if v}}  # fmt: skip


def build_profile(events: list[dict[str, Any]], enabled: bool = True) -> DirectorProfile:
    """Plain statistics over the feedback events."""
    counts = Counter(e["event"] for e in events)
    accepted = [e.get("facts", {}) for e in events if e["event"] == "accepted"]
    prefs: dict[str, Any] = {}
    if accepted:
        prefs["avgShotSeconds"] = round(mean(a["avgShot"] for a in accepted if a.get("avgShot")), 2) if any(a.get("avgShot") for a in accepted) else None
        durs = [a["duration"] for a in accepted if a.get("duration")]
        if durs:
            prefs["duration"] = round(median(durs))
        styles = Counter(a.get("style") for a in accepted if a.get("style"))
        styles.update(e.get("facts", {}).get("to") for e in events if e["event"] == "changed_style" and e.get("facts", {}).get("to"))
        if styles:
            prefs["style"] = styles.most_common(1)[0][0]
    avg = prefs.get("avgShotSeconds")
    if avg:
        prefs["pace"] = "fast" if avg < 1.4 else ("calm" if avg > 2.8 else "balanced")
    tr_ratio = mean(a.get("transitionRatio", 0.0) for a in accepted) if accepted else None
    removed_tr, added_tr = counts["removed_transition"], counts["added_transition"]
    prefs["transitions"] = "minimal" if (removed_tr >= 2 and removed_tr > added_tr) or (tr_ratio is not None and tr_ratio < 0.12) else (
        "more" if added_tr >= 2 and added_tr > removed_tr else "as styled")  # fmt: skip
    prefs["effects"] = "minimal" if counts["removed_effect"] >= 2 and counts["removed_effect"] > counts["added_effect"] else "as styled"
    prefs["hook"] = "aggressive" if counts["rejected_opening"] >= 2 else "balanced"
    texts = [a.get("texts", 0) for a in accepted]
    prefs["text"] = "minimal" if (texts and mean(texts) <= 1) or counts["edited_text"] >= 3 else "as styled"
    if accepted and any(a.get("avgShot") for a in accepted):  # the shot lengths the person keeps (e.g. 0.7-1.2 s)
        shots = sorted(a["avgShot"] for a in accepted if a.get("avgShot"))
        prefs["shotRange"] = [round(shots[len(shots) // 4], 2), round(shots[(3 * len(shots)) // 4], 2)]
    concepts = Counter(a.get("concept") for a in accepted if a.get("concept"))
    concepts.update(e.get("facts", {}).get("concept") for e in events if e["event"] == "chose_concept" and e.get("facts", {}).get("concept"))
    if concepts and concepts.most_common(1)[0][1] >= 2:
        prefs["concept"] = concepts.most_common(1)[0][0]
    evidence = sum(counts[k] for k in EVENTS if k != "regenerated")
    return DirectorProfile(evidence >= MIN_EVIDENCE, evidence, prefs, dict(counts), enabled)


async def load_profile() -> DirectorProfile:
    from app.storage import get_storage

    enabled = True
    try:
        st = get_storage()
        if st.exists(PROFILE_KEY):
            enabled = bool(json.loads(st.read_bytes(PROFILE_KEY)).get("enabled", True))
    except (ValueError, OSError):
        enabled = True
    events = [e async for e in get_db().feedback.find({}, {"event": 1, "facts": 1}).sort("at", -1).limit(2000)]
    return build_profile(events, enabled)


def set_enabled(enabled: bool) -> None:
    from app.storage import get_storage

    get_storage().write_bytes(PROFILE_KEY, json.dumps({"enabled": bool(enabled)}).encode())


async def reset() -> int:
    res = await get_db().feedback.delete_many({})
    return res.deleted_count


def apply_profile(style, pace: str, profile: dict[str, Any] | None):
    """The person's taste on the parts they left automatic. Returns (style, notes)."""
    from app.styles.resolve import apply_pace

    if not profile or not profile.get("ready") or not profile.get("enabled", True):
        return style, []
    p = profile.get("preferences", {})
    notes: list[str] = []
    if pace == "auto" and p.get("pace") in ("calm", "balanced", "fast"):
        style = apply_pace(style, p["pace"])
        notes.append(f"{p['pace']} pace (your Reels average {p.get('avgShotSeconds')}s per shot)")
    if p.get("transitions") == "minimal" and style.max_transition_ratio > 0.15:
        style = style.with_overrides(max_transition_ratio=0.15)
        notes.append("fewer transitions (you usually remove them)")
    if p.get("effects") == "minimal":
        w = dict(style.effects)
        w["none"] = w.get("none", 0.0) + max(sum(w.values()), 1.0)
        style = style.with_overrides(effects=w)
        notes.append("fewer effects (you usually remove them)")
    if p.get("hook") == "aggressive" and style.hook_priority < 0.6:
        style = style.with_overrides(hook_priority=0.6)
        notes.append("a stronger opening (you often replaced the first shot)")
    return style, ([f"Your director profile: {'; '.join(notes)}."] if notes else [])
