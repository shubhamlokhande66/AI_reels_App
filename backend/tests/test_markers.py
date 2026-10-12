"""Editor beat markers and auto-cut (services/markers.py)."""

from __future__ import annotations

from app.models.analysis import AudioAnalysis
from app.models.timeline import Segment, Timeline, Transition
from app.services.markers import DENSITIES, cut_onto, song_markers


def _analysis():
    beats = [round(k * 0.5, 3) for k in range(40)]  # 120 BPM
    return AudioAnalysis(bpm=120, duration=20, beats=beats, beat_levels=[4 if k % 4 == 0 else 2 if k % 2 else 1 for k in range(40)],
                         downbeats=beats[::4], strong_beats=beats[::4] + [beats[6]], medium_beats=beats[2::4], drops=[8.0])  # fmt: skip


def test_markers_carry_the_beat_kind_and_the_persons_own_marks():
    ms = song_markers(_analysis(), 2.0, 10.0, {"added": [3.25], "removed": [3.0]})
    kinds = {m["t"]: m["kind"] for m in ms}
    assert kinds[2.0] == "strong" and kinds[5.0] == "medium" and 2.5 not in kinds  # beat 10 (5.0 s) is medium, 2.5 s weak
    assert kinds[3.25] == "custom" and 3.0 not in kinds  # 3.0 s was removed by hand
    assert all(m["kind"] in ("strong", "medium", "drop", "custom") for m in ms)
    assert kinds[8.0] in ("drop", "bar") and any(m["kind"] == "drop" for m in ms)
    assert all(2.0 <= m["t"] <= 10.0 for m in ms)


def test_auto_cut_lands_on_the_markers_keeps_the_clips_in_order_and_never_cuts_too_short():
    segs = [Segment(id=f"seg{i}", clip_id=f"c{i}", video=f"c{i}", source_start=1.0, source_end=4.0, timeline_start=i * 3.0, timeline_end=(i + 1) * 3.0,
                    transition_in=Transition(type="dissolve", duration=0.4) if i else Transition()) for i in range(3)]  # fmt: skip
    tl = Timeline(duration=9.0, segments=segs)
    points = [0.25, 0.5, 1.0, 1.1, 2.0, 3.0, 4.0, 6.0, 8.0, 8.8]  # some too close together, one too near the end
    out = cut_onto(tl, points, min_clip=0.4, clip_seconds={"c0": 10.0, "c1": 10.0, "c2": 2.5})
    starts = [s.timeline_start for s in out.segments]
    assert starts == [0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0]  # 0.25 and 1.1 too soon after a cut, 8.8 too near the end
    assert out.segments[-1].timeline_end == 9.0 and all(s.length >= 0.4 - 1e-9 for s in out.segments)
    assert [s.clip_id for s in out.segments] == sorted(s.clip_id for s in out.segments)  # the clips keep their order
    c0 = [s for s in out.segments if s.clip_id == "c0"]
    assert all(abs(a.source_end - b.source_start) < 1e-6 for a, b in zip(c0, c0[1:]))  # its footage runs on
    assert all(s.source_end <= 2.5 + 1e-6 for s in out.segments if s.clip_id == "c2")  # a short clip starts earlier
    assert set(DENSITIES) == {"both", "strong", "drops"}
