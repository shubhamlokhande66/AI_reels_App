"""Find uploads that are the same video under another name (WhatsApp "(1)" / "(2)" copies, a re-exported or trimmed copy).

Every clip is reduced to small grey thumbnails, one every ``STEP`` seconds. Clip B is a duplicate of clip A when its
sampled frames all match frames of A, at one consistent time offset (so a trimmed copy is found too). Only one copy of
each video is used in a Reel; the others are left out and the Reel says so.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

STEP = 0.25  # seconds between thumbnails
THUMB = 32
MATCH = 10.0  # mean absolute difference (0-255) below which two thumbnails show the same picture
PROBES = 6  # frames of the candidate duplicate that must all match
OFFSET_TOLERANCE = 0.6  # seconds
ASPECT_TOLERANCE = 0.10  # two clips of different shape (landscape vs portrait) are never called copies


@dataclass
class Duplicate:
    clip_id: str  # the copy that is left out
    same_as: str  # the clip kept
    offset: float  # B time t shows what A shows at t + offset


class Thumbs(np.ndarray):
    """Thumbnails that also remember the clip's aspect ratio (width / height of the decoded frames)."""

    aspect: float = 0.0


def thumbnails(path: Path, duration: float) -> Thumbs:
    """(n, 32*32) float thumbnails, one every STEP seconds (normalised for brightness so a re-encode still matches)."""
    cap = cv2.VideoCapture(str(path))
    out: list[np.ndarray] = []
    aspect = 0.0
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        every = max(int(round(fps * STEP)), 1)
        i = 0
        while True:
            ok = cap.grab()
            if not ok:
                break
            if i % every == 0:
                ok, frame = cap.retrieve()
                if ok and frame is not None:
                    aspect = aspect or frame.shape[1] / max(frame.shape[0], 1)
                    g = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (THUMB, THUMB), interpolation=cv2.INTER_AREA).astype(np.float32)
                    out.append((g - g.mean()).ravel())
            i += 1
            if i / fps > duration + 1:
                break
    finally:
        cap.release()
    arr = (np.array(out, dtype=np.float32) if out else np.zeros((0, THUMB * THUMB), np.float32)).view(Thumbs)
    arr.aspect = aspect
    return arr


def _same_shape(a: np.ndarray, b: np.ndarray) -> bool:
    ra, rb = getattr(a, "aspect", 0.0), getattr(b, "aspect", 0.0)
    return not (ra and rb) or abs(ra - rb) / max(ra, rb) <= ASPECT_TOLERANCE


def _contained(b: np.ndarray, a: np.ndarray) -> float | None:
    """The time offset at which every probe frame of ``b`` is found in ``a`` (None = b is not a copy of a)."""
    if len(b) < 2 or len(a) < 2:
        return None
    probes = np.linspace(0, len(b) - 1, num=min(PROBES, len(b))).astype(int)
    first = np.abs(a - b[probes[0]]).mean(axis=1)
    slack = max(int(round(OFFSET_TOLERANCE / STEP)), 1)
    # every place the first probe frame appears in ``a`` is a candidate offset (footage with repeating motion has several);
    # the copy is the offset at which ALL probe frames match
    for j in np.argsort(first):
        if first[j] > MATCH:
            break
        off = int(j) - int(probes[0])
        ok = True
        for k in probes[1:]:
            lo, hi = max(k + off - slack, 0), min(k + off + slack + 1, len(a))
            if lo >= hi or np.abs(a[lo:hi] - b[k]).mean(axis=1).min() > MATCH:
                ok = False
                break
        if ok:
            return off * STEP
    return None


def find_duplicates(clips: list[tuple[str, np.ndarray]]) -> list[Duplicate]:
    """``clips``: (clip id, thumbnails) in upload order. The longer copy (or the first uploaded) is kept."""
    dups: list[Duplicate] = []
    gone: set[str] = set()
    order = sorted(range(len(clips)), key=lambda i: (-len(clips[i][1]), i))  # longest first: a trimmed copy is inside it
    for x, i in enumerate(order):
        a_id, a = clips[i]
        if a_id in gone:
            continue
        for j in order[x + 1 :]:
            b_id, b = clips[j]
            if b_id in gone:
                continue
            off = _contained(b, a) if _same_shape(a, b) else None
            if off is not None:
                dups.append(Duplicate(clip_id=b_id, same_as=a_id, offset=round(off, 2)))
                gone.add(b_id)
    return dups
