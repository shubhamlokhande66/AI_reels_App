"""Observability: one record per generation, for debugging and future tuning.

For every finished generate / variations / render job: the project, which analysis versions were used, which AI
provider and model (and the director's prompt version), the brief and the Creative Plan, the EDL version, the render,
the Reviewer's score card and how many self-correction rounds ran, and the final output. No media, no file names of
the person's clips beyond what the project already stores; nothing leaves the machine.
"""

from __future__ import annotations

import logging
from typing import Any

from bson import ObjectId

from app.core.database import get_db
from app.models.base import utcnow

log = logging.getLogger(__name__)


def generation_doc(project_oid: ObjectId, job_id: ObjectId, job_type: str, rendering_id: Any, result, kind: str = "final",
                   label: str = "") -> dict[str, Any]:  # fmt: skip
    from app.ai.reel_director import PROMPT_VERSION
    from app.audio.analyzer import ANALYSIS_VERSION
    from app.ai.understanding import SEMANTIC_VERSION
    from app.video.analyzer import VIDEO_ANALYSIS_VERSION

    tl = result.timeline
    plan = result.reel_plan or {}
    card = plan.get("scorecard") or {}
    ai = tl.ai.to_doc() if tl is not None and tl.ai is not None else None
    return {
        "_id": ObjectId(), "projectId": project_oid, "jobId": job_id, "type": job_type, "kind": kind, "label": label,
        "renderingId": rendering_id, "createdAt": utcnow(),
        "analysisVersion": {"audio": ANALYSIS_VERSION, "video": VIDEO_ANALYSIS_VERSION, "semantic": SEMANTIC_VERSION},
        "ai": ai, "promptVersion": PROMPT_VERSION if ai and ai.get("director") else None,
        "brief": tl.brief if tl is not None else None, "creativePlan": tl.creative_plan if tl is not None else None,
        "edlVersion": tl.edl_version if tl is not None else None, "shots": len(tl.segments) if tl is not None else 0,
        "style": tl.style if tl is not None else None, "duration": round(tl.duration, 2) if tl is not None else None,
        "reviewerScore": card.get("overallScore"), "scorecard": card or None,
        "correctionIterations": len(plan.get("selfCorrection") or []),
        "correctionsKept": sum(1 for r in plan.get("selfCorrection") or [] if r.get("kept")),
        "output": result.output_key,
        "variants": [{"strategy": v.strategy_id, "renderingId": v.rendering_id, "concept": (v.timeline.creative_plan or {}).get("concept")}
                     for v in result.variants] or None,  # fmt: skip
    }


async def record_generation(*args, **kwargs) -> None:
    """Never breaks a job: a failure to log is only logged."""
    try:
        await get_db().generations.insert_one(generation_doc(*args, **kwargs))
    except Exception as exc:  # noqa: BLE001
        log.info("generation not recorded: %s", exc)


def _out(d: dict[str, Any]) -> dict[str, Any]:
    return {("id" if k == "_id" else k): (str(v) if isinstance(v, ObjectId) else v) for k, v in d.items()}


async def list_generations(project_oid: ObjectId, limit: int = 50) -> list[dict[str, Any]]:
    return [_out(d) async for d in get_db().generations.find({"projectId": project_oid}).sort("createdAt", -1).limit(limit)]
