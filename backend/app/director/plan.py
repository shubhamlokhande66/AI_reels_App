"""The Reel plan: one readable document of every decision, for the person and for tests.

It describes the timeline that will be rendered (after quality control has repaired it), shot by shot, with the music event each
shot answers. It never claims more than the app knows: subjects come from the vision model, and say "not analysed" without it.
"""

from __future__ import annotations

from app.director.music_map import LEVEL_ACTION, LEVEL_NAMES, MusicMap
from app.director.review import Check
from app.director.story import FINAL_STAGES, Category, stage_of
from app.models.timeline import Segment, Timeline
from app.video.timeline import ClipInput

FORMAT = "1080x1920"
LIMITS = [
    "Shots come from your own footage: nothing is generated.",
    "Subjects and stages come from the vision model when 'AI assist' is on; otherwise the plan says they were not analysed.",
    "Vocal entry and vocal emphasis are not detected.",
]


def _music_event(mm: MusicMap, t: float) -> str:
    lvl = mm.level_at(t)
    if any(abs(d - t) <= 0.15 for d in mm.drops):
        return "drop"
    if any(abs(p - t) <= 0.06 for p in mm.phrases):
        return "start of a musical phrase"
    return f"{LEVEL_NAMES[lvl]} beat" if any(abs(b.t - t) <= 0.06 for b in mm.beats) else "between beats"


def _purpose(i: int, n: int, seg: Segment, clip: ClipInput | None, teaser: bool, steps: bool) -> str:
    sem = clip.semantic if clip else None
    stage = stage_of(sem)
    if i == 0 and teaser:
        return "hook: finished result teaser"
    if i == 0:
        return "hook"
    if i == n - 1:
        return "ending: final dish" if stage in FINAL_STAGES else "ending"
    if steps and stage:
        return f"step: {stage}"
    if sem and sem.action:
        return f"action: {sem.action[:40]}"
    return "moment"


def build_reel_plan(
    tl: Timeline, clips: list[ClipInput], mm: MusicMap, category: Category, checks: list[Check], *, steps: bool, teaser: bool,
    story_notes: list[str] | None = None, label: str = "",
) -> dict:
    by_id = {c.clip_id: c for c in clips}
    n = len(tl.segments)
    shots = []
    for i, s in enumerate(tl.segments):
        clip = by_id.get(s.clip_id)
        sem = clip.semantic if clip else None
        text = [c.text for c in tl.captions if c.start < s.timeline_end - 0.01 and c.end > s.timeline_start + 0.01]
        lvl = mm.level_at(s.timeline_start)
        shots.append({
            "index": i + 1, "start": round(s.timeline_start, 3), "end": round(s.timeline_end, 3), "asset": s.video,
            "sourceStart": round(s.source_start, 3), "sourceEnd": round(s.source_end, 3),
            "purpose": _purpose(i, n, s, clip, teaser and i == 0, steps),
            "subject": (sem.summary or sem.scene) if sem and (sem.summary or sem.scene) else "not analysed",
            "shotType": sem.camera if sem else None,
            "camera": {"punch": "punch on a hit", "zoom_in": "slow push in", "zoom_out": "slow pull out"}.get(s.effect, "steady") + f", focus on {s.focus_source}",
            "speed": s.speed,
            "transition": s.transition_in.type,
            "text": text[0] if text else None,
            "musicEvent": _music_event(mm, s.timeline_start),
            "beatLevel": lvl, "beatLevelName": LEVEL_NAMES[lvl], "mayTrigger": LEVEL_ACTION[lvl],
            "energy": mm.energy_at(s.timeline_start),
            "importance": round(sem.importance, 2) if sem else None,
            "why": s.reason,
        })
    first, last = tl.segments[0], tl.segments[-1]
    lc = by_id.get(last.clip_id)
    last_stage = stage_of(lc.semantic) if lc else None
    return {
        "label": label,
        "duration": round(tl.duration, 3),
        "format": FORMAT,
        "category": {"name": category.name, "confidence": category.confidence, "source": category.source, "evidence": category.evidence},
        "music": mm.to_doc(),
        "hook": {"asset": first.video, "start": round(first.timeline_start, 3), "end": round(first.timeline_end, 3),
                 "kind": "finished-result teaser" if teaser else "opening shot"},
        "story": (story_notes or []) + ([] if steps else ["Best moments, mixed: no recipe order is applied in this mode."]),
        "shots": shots,
        "ending": {"asset": last.video, "purpose": "final dish" if last_stage in FINAL_STAGES else "closing shot"},
        "quality": [c.to_doc() for c in checks],
        "limits": LIMITS,
    }
