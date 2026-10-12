"""Beat markers in the editor, CapCut-style but measured: the song's real beats for the part the Reel plays, each with
its level (bar start / strong beat / beat), the drops, and the person's own markers (added or removed by hand, kept in
song time so they stay right if the Reel's part of the song moves). And auto-cut: the Reel's clips re-cut onto the
markers of a chosen density, as one undoable edit.

Only the **strong and medium beats** are markers (audio/accents.py; each on its real hit), plus the drops and the
person's own markers; weak beats are left out. Densities: ``both`` (strong + medium), ``strong``, ``drops``; the
person's own markers count in all.
"""

from __future__ import annotations

from typing import Any

from app.core.database import get_db
from app.core.errors import ValidationFailed
from app.jobs import pipeline as pl
from app.models.timeline import Segment, Timeline, Transition
from app.storage import get_storage

DENSITIES = {
    "both": ("strong", "medium", "drop", "custom"),
    "strong": ("strong", "drop", "custom"),
    "drops": ("drop", "custom"),
}
SAME = 0.04  # a hand-removed marker this close to a beat removes it


def _near(times: list[float], t: float, tol: float) -> bool:
    return any(abs(x - t) <= tol for x in times)


async def _context(project_id: str) -> tuple[dict[str, Any], Timeline, Any]:
    from app.services import music_reel as mr
    from app.video.timeline_ops import ensure_ids

    from app.services import timeline_service as ts

    doc, inp = await mr.project_input(project_id, need_videos=False)
    current = ts.state_of(await ts.load(project_id))["timeline"]  # the edit as the editor shows it (its history)
    if not current:
        raise ValidationFailed("Add your clips first: there is no edit to put beat markers on.", code="NO_TIMELINE")
    import asyncio

    analysis = await asyncio.to_thread(pl.analyze_music, inp, get_storage(), lambda *_: None)
    return doc, Timeline.model_validate(ensure_ids(current)), analysis


PEAKS_PER_SECOND = 40


def song_peaks(path) -> list[float]:
    """The song's waveform for the editor: the loudest level of every 1/PEAKS_PER_SECOND s, 0..1, made once per song
    and kept next to it."""
    import json
    from pathlib import Path

    import librosa
    import numpy as np

    path = Path(path)
    saved = path.with_suffix(path.suffix + ".peaks.json")
    if saved.exists() and saved.stat().st_mtime >= path.stat().st_mtime:
        return json.loads(saved.read_text())
    y, sr = librosa.load(str(path), sr=8000, mono=True)
    step = sr // PEAKS_PER_SECOND
    n = len(y) // step
    peaks = np.abs(y[: n * step]).reshape(n, step).max(axis=1) if n else np.zeros(0)
    top = float(np.percentile(peaks, 99.5)) if n else 1.0
    out = [round(float(min(v / top, 1.0)), 3) for v in peaks] if top > 0 else [0.0] * n
    saved.write_text(json.dumps(out))
    return out


def song_markers(analysis, start: float, end: float, own: dict[str, list[float]] | None = None) -> list[dict[str, Any]]:
    """Markers (song time) from ``start`` to ``end``: every beat with its kind, the drops, and the person's own."""
    own = own or {}
    removed, added = own.get("removed", []), own.get("added", [])
    downs, strong, drops = sorted(analysis.downbeats), sorted(analysis.strong_beats), sorted(analysis.drops)
    medium = sorted(analysis.medium_beats)
    # a drop sits on its beat's real hit (the beats are on their hits; drops come from the energy, a beat earlier)
    drops = [min(analysis.beats, key=lambda b: abs(b - d)) if analysis.beats and min(abs(b - d) for b in analysis.beats) <= 0.1 else d for d in drops]
    levels = analysis.beat_levels if len(analysis.beat_levels) == len(analysis.beats) else [1] * len(analysis.beats)
    out = []
    for t, level in zip(analysis.beats, levels):
        if not start - 1e-6 <= t <= end + 1e-6 or _near(removed, t, SAME) or _near(drops, t, 0.005):
            continue  # (a drop's own beat is shown as the drop)
        kind = "strong" if _near(strong, t, 0.02) or level >= 4 else "medium" if _near(medium, t, 0.02) else None
        if kind is None:
            continue  # a weak beat: not a marker
        out.append({"t": round(t, 3), "kind": kind, "level": level, "barStart": _near(downs, t, 0.02)})
    for d in drops:
        if start <= d <= end and not _near(removed, d, SAME):
            out.append({"t": round(d, 3), "kind": "drop", "level": 5})
    for t in added:
        if start <= t <= end:
            out.append({"t": round(t, 3), "kind": "custom", "level": 5})
    return sorted(out, key=lambda m: m["t"])


async def markers(project_id: str) -> dict[str, Any]:
    """The Reel's markers in Reel time (0 = the Reel's first frame)."""
    doc, tl, analysis = await _context(project_id)
    own = doc.get("beatMarkers") or {}
    ms = song_markers(analysis, tl.audio_start, tl.audio_start + tl.duration, own)
    import asyncio

    from app.services import music_reel as mr

    _, inp = await mr.project_input(project_id, need_videos=False)
    peaks = await asyncio.to_thread(song_peaks, get_storage().local_path(inp.audio.key))
    i0 = int(tl.audio_start * PEAKS_PER_SECOND)
    return {
        "waveform": {"perSecond": PEAKS_PER_SECOND, "peaks": peaks[i0: i0 + int(tl.duration * PEAKS_PER_SECOND) + 1]},
        "markers": [{**m, "t": round(m["t"] - tl.audio_start, 3)} for m in ms],
        "barConfidence": round(analysis.downbeat_confidence, 2), "bpm": round(analysis.bpm, 1), "audioStart": tl.audio_start,
        "duration": tl.duration, "densities": list(DENSITIES), "own": {"added": len(own.get("added", [])), "removed": len(own.get("removed", []))},
    }  # fmt: skip


async def edit_markers(project_id: str, add: list[float], remove: list[float]) -> dict[str, Any]:
    """Add / remove markers by hand (Reel times in, kept in song time). Removing a hand-made marker deletes it;
    removing a detected beat hides it."""
    doc, tl, _ = await _context(project_id)
    own = doc.get("beatMarkers") or {"added": [], "removed": []}
    added, removed = list(own.get("added", [])), list(own.get("removed", []))
    for t in remove:
        song = round(tl.audio_start + t, 3)
        mine = [x for x in added if abs(x - song) <= SAME]
        if mine:
            added = [x for x in added if x not in mine]
        elif not _near(removed, song, SAME):
            removed.append(song)
    for t in add:
        song = round(tl.audio_start + t, 3)
        removed = [x for x in removed if abs(x - song) > SAME]  # adding where a beat was hidden brings it back
        if not _near(added, song, 0.02):
            added.append(song)
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": {"beatMarkers": {"added": sorted(added), "removed": sorted(removed)}}})
    return await markers(project_id)


def cut_onto(tl: Timeline, points: list[float], min_clip: float, clip_seconds: dict[str, float]) -> Timeline:
    """The Reel re-cut at ``points`` (Reel times): no shot under ``min_clip``; the clips keep their order, each spread
    over the new shots in turn with its footage running on (a clip shorter than its new shots starts earlier)."""
    cuts: list[float] = []
    for p in sorted(points):
        if p - (cuts[-1] if cuts else 0.0) >= min_clip and tl.duration - p >= min_clip:
            cuts.append(round(p, 3))
    bounds = [0.0, *cuts, round(tl.duration, 3)]
    old = tl.segments
    n = len(bounds) - 1
    segs: list[Segment] = []
    cursor: dict[int, float] = {}
    for i in range(n):
        k = min(i * len(old) // n, len(old) - 1)
        src = old[k]
        length = bounds[i + 1] - bounds[i]
        need = length * src.speed
        start = cursor.get(k, src.source_start)
        dur = clip_seconds.get(src.clip_id)
        if dur is not None and start + need > dur:  # the clip ran out: its footage starts earlier
            start = max(dur - need, 0.0)
        cursor[k] = start + need
        first = k not in [min(j * len(old) // n, len(old) - 1) for j in range(i)]
        way_in = src.transition_in if first and i > 0 else Transition(type="cut", duration=0.0)
        if way_in.type not in ("cut", "speed_ramp"):  # a transition fits its new shots
            prev_len = bounds[i] - bounds[i - 1] if i > 0 else length
            way_in = Transition(type=way_in.type, duration=round(min(way_in.duration, 0.4 * min(length, prev_len)), 3))
        segs.append(src.model_copy(deep=True, update={
            "id": f"{src.id[:8]}{i:04d}", "timeline_start": bounds[i], "timeline_end": bounds[i + 1], "source_start": round(start, 3),
            "source_end": round(start + need, 3), "transition_in": way_in, "keyframes": [], "locked": False,
        }))  # fmt: skip
    return tl.model_copy(update={"segments": segs})


async def auto_cut(project_id: str, density: str = "both", min_clip: float = 0.4) -> dict[str, Any]:
    """Re-cut the Reel onto the markers of ``density`` and give the shots their motion from the music again
    (director/plan_motion.py), as one undoable step."""
    from app.director.plan_motion import add_motion
    from app.services import timeline_service as ts

    if density not in DENSITIES:
        raise ValidationFailed(f"Unknown density '{density}'.", code="BAD_DENSITY", details={"available": list(DENSITIES)})
    doc, tl, analysis = await _context(project_id)
    found = await markers(project_id)
    points = [m["t"] for m in found["markers"] if m["kind"] in DENSITIES[density]]
    if not points:
        raise ValidationFailed("There are no markers of that kind in this part of the song.", code="NO_MARKERS")
    ctx = await ts.context_for(doc)
    new = cut_onto(tl, points, min_clip, ctx.clip_durations)
    notes = add_motion(new.segments, analysis, new.audio_start, ctx.clip_durations)
    new = new.model_copy(update={"notes": [n for n in new.notes if not n.startswith(("Motion from", "Speed ramps"))] + notes})
    label = {"both": "strong + medium beats", "strong": "strong beats", "drops": "drops"}[density]
    return await ts.replace(project_id, new, f"Auto-cut to {label}")
