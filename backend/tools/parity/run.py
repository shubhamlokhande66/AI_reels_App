"""Parity runner for the Next.js migration: reads JSON cases on stdin, runs them through the Python code, writes
results on stdout. A case is {"kind": ..., ...}; see frontend/tests/server/*.parity.test.ts."""

from __future__ import annotations

import json
import sys

from pydantic import TypeAdapter

from app.core.errors import AppError


def ops_case(c: dict) -> dict:
    from app.models.timeline import Timeline
    from app.video.timeline_ops import OpContext, Operation, apply_operations

    tl = Timeline.model_validate(c["timeline"])
    ops = TypeAdapter(list[Operation]).validate_python(c["ops"])
    ctx = OpContext(clip_durations=c["ctx"]["clipDurations"], clip_names=c["ctx"]["clipNames"], audio_duration=c["ctx"]["audioDuration"])
    try:
        return {"ok": True, "timeline": apply_operations(tl, ops, ctx).to_doc()}
    except AppError as e:
        return {"ok": False, "code": e.code, "message": e.message}


def keyframes_case(c: dict) -> dict:
    from app.models.timeline import Keyframe
    from app.video import keyframes as kf

    ks = [Keyframe.model_validate(k) for k in c["keyframes"]]
    v, notes = kf.validate(ks, c["length"])
    return {"keyframes": [k.to_doc() for k in v], "notes": notes, "source": kf.source_seconds(v, c["length"]),
            "motion": kf.motion_chain(v, 1080, 1920), "frame": kf.frame_filters(v, 1080, 1920),
            "setpts": kf.speed_setpts(v, c["length"]) if kf.has_speed(v) else None}


KINDS = {"ops": ops_case, "keyframes": keyframes_case}

if __name__ == "__main__":
    cases = json.load(sys.stdin)
    json.dump([KINDS[c["kind"]](c) for c in cases], sys.stdout)
