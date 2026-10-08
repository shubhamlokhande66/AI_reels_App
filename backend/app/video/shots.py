"""Shot intelligence: what kind of shot a frame is and how well it is composed, measured on the analyzer's small grey
frames (no extra decoding, no AI, no detector model).

* subject: the largest frontal face (Haar, from the analyzer) or else the most *salient* region (spectral-residual
  saliency, Hou & Zhang 2007, on a 64x64 thumbnail): the part of the picture that stands out from its surroundings;
* shot size: close / medium / wide from the face height, or from how much of the frame the subject fills;
* composition (0..1), judged for the vertical 9:16 output (the renderer crops around the focus point, so horizontal
  placement matters less than vertical placement): subject near the upper third or the centre line, not cut by the
  frame edge, big enough to read on a phone, headroom above a face;
* empty frame: almost no edges and nothing salient (a blank wall, sky, floor);
* camera vs subject motion: the global shift (phase correlation) is the camera; what still moves after the previous
  frame is shifted by that amount is the subject.

These are heuristics and the analysis says so: good enough to prefer a clear close-up over a cluttered wide shot,
not an object detector.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

SAL_SIZE = 64
EMPTY_EDGES = 0.012  # share of edge pixels below which a frame has "nothing in it"
CLOSE_FACE, MEDIUM_FACE = 0.28, 0.11  # face height as a share of the frame height
CLOSE_AREA, MEDIUM_AREA = 0.30, 0.10  # salient subject box as a share of the frame area


@dataclass
class FrameLook:
    subject: tuple[float, float, float, float] | None  # normalised x0, y0, x1, y1
    subject_strength: float  # 0..1 how much the subject stands out
    edges: float  # share of edge pixels
    face_h: float | None = None  # face height / frame height when a face was found
    focus: float = 1.0  # detail inside the subject box / detail around it (>1.3: the subject is sharper than its surroundings)

    @property
    def empty(self) -> bool:
        return self.edges < EMPTY_EDGES and self.face_h is None and self.subject_strength < 0.35

    @property
    def area(self) -> float:
        if self.subject is None:
            return 0.0
        x0, y0, x1, y1 = self.subject
        return max(x1 - x0, 0.0) * max(y1 - y0, 0.0)


def saliency(gray: np.ndarray) -> np.ndarray:
    """Spectral-residual saliency map (SAL_SIZE x SAL_SIZE, 0..1)."""
    small = cv2.resize(gray, (SAL_SIZE, SAL_SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
    f = np.fft.fft2(small)
    log_amp = np.log(np.abs(f) + 1e-6).astype(np.float32)
    residual = log_amp - cv2.blur(log_amp, (3, 3))
    sal = np.abs(np.fft.ifft2(np.exp(residual + 1j * np.angle(f)))) ** 2
    sal = cv2.GaussianBlur(sal.astype(np.float32), (9, 9), 2.5)
    hi = float(sal.max())
    return sal / hi if hi > 1e-12 else np.zeros_like(sal)


def salient_box(gray: np.ndarray) -> tuple[tuple[float, float, float, float] | None, float]:
    """The box around the most salient blob and how strongly it stands out (peak contrast vs the mean)."""
    sal = saliency(gray)
    mean = float(sal.mean())
    if mean <= 1e-9:
        return None, 0.0
    mask = (sal > max(3.0 * mean, 0.25)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return None, 0.0
    # saliency lights up a subject's outline, often in pieces: the subject is the union of the strong blobs
    weight = [float(stats[i, cv2.CC_STAT_AREA] * sal[labels == i].mean()) for i in range(1, n)]
    keep = [i + 1 for i, wt in enumerate(weight) if wt >= 0.25 * max(weight)]
    x0 = min(int(stats[i, cv2.CC_STAT_LEFT]) for i in keep)
    y0 = min(int(stats[i, cv2.CC_STAT_TOP]) for i in keep)
    x1 = max(int(stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH]) for i in keep)
    y1 = max(int(stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT]) for i in keep)
    inside = np.isin(labels, keep)
    strength = float(np.clip((sal[inside].mean() / mean - 1.5) / 4.0, 0.0, 1.0))
    s = float(SAL_SIZE)
    w_, h_ = (x1 - x0) / s, (y1 - y0) / s
    if max(w_, h_) > 0.85 and min(w_, h_) / max(w_, h_) < 0.45:
        return None, 0.0  # a strip across the frame (a horizon, a tree line) is scenery, not a subject
    touches = sum((x0 <= 1, y0 <= 1, x1 >= SAL_SIZE - 1, y1 >= SAL_SIZE - 1))
    if touches >= 2 and w_ * h_ >= 0.45:
        return None, 0.0  # half the frame, running off two edges: that is the scene itself, not an object in it
    fill = float(inside.sum()) / max((x1 - x0) * (y1 - y0), 1)
    if w_ * h_ > 0.2 and fill < 0.15 and len(keep) >= 4:
        return None, 0.0  # salient bits scattered over a big area: busy scenery (leaves, crowds), nothing dominates
    return (x0 / s, y0 / s, x1 / s, y1 / s), round(strength, 3)


def skin_share(bgr: np.ndarray) -> float:
    """Share of skin-coloured pixels (YCrCb range that covers all skin tones). Haar cascades also fire on foliage and
    brickwork; a real face has skin in its box."""
    if bgr.size == 0:
        return 0.0
    ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    cr, cb = ycc[..., 1], ycc[..., 2]
    # a wide range: every skin tone, also under warm or cool light (still excludes green leaves and grey stone)
    return float(((cr >= 128) & (cr <= 185) & (cb >= 70) & (cb <= 140)).mean())


def look_of(gray: np.ndarray, face_box: tuple[float, float, float, float] | None = None) -> FrameLook:
    """``face_box``: normalised x0, y0, x1, y1 of the largest face, when the analyzer found one."""
    edges = float((cv2.Canny(gray, 60, 160) > 0).mean())
    if face_box is not None:
        return FrameLook(face_box, 1.0, edges, face_h=face_box[3] - face_box[1])
    box, strength = salient_box(gray)
    return FrameLook(box, strength, edges, focus=focus_ratio(gray, box) if box is not None else 1.0)


def focus_ratio(gray: np.ndarray, box: tuple[float, float, float, float]) -> float:
    """How much sharper the subject box is than the rest of the frame. A close-up / product shot usually has its subject
    in focus over a softer or plainer background; in scenery (a park, a street) everything is about equally detailed."""
    h, w = gray.shape
    x0, y0, x1, y1 = int(box[0] * w), int(box[1] * h), max(int(box[2] * w), int(box[0] * w) + 1), max(int(box[3] * h), int(box[1] * h) + 1)
    lap = np.abs(cv2.Laplacian(gray, cv2.CV_32F))
    inside = lap[y0:y1, x0:x1]
    mask = np.ones_like(lap, dtype=bool)
    mask[y0:y1, x0:x1] = False
    out = lap[mask]
    if inside.size == 0 or out.size < 0.05 * lap.size:
        return 1.0  # the box is (nearly) the whole frame: nothing to compare against
    return round(float(inside.mean() / max(out.mean(), 1e-3)), 3)


def shot_size(look: FrameLook) -> str:
    if look.face_h is not None:
        return "close" if look.face_h >= CLOSE_FACE else "medium" if look.face_h >= MEDIUM_FACE else "wide"
    if look.subject is None or look.subject_strength < 0.15 or look.empty:
        return "wide"  # nothing dominates: a scene, not a subject
    if look.focus < 1.15:
        return "wide"  # the "subject" is no sharper than everything around it: scenery
    return "close" if look.area >= CLOSE_AREA else "medium" if look.area >= MEDIUM_AREA else "wide"


def composition(look: FrameLook) -> float:
    """0..1 for the vertical output. Without a clear subject the frame is judged neutral (0.5), empty frames low."""
    if look.empty:
        return 0.15
    if look.subject is None or look.subject_strength < 0.15:
        return 0.5
    x0, y0, x1, y1 = look.subject
    cy = (y0 + y1) / 2
    cx = (x0 + x1) / 2
    # vertical placement: the upper third line or the centre both work in a 9:16 frame
    place_y = 1.0 - min(abs(cy - 1 / 3), abs(cy - 0.5)) / 0.35
    # horizontal: the crop recentres on the focus point, so only extreme edge placement costs a little
    place_x = 1.0 - max(abs(cx - 0.5) - 0.3, 0.0) / 0.2
    margin = 0.02
    cut = sum(v <= margin for v in (x0, y0)) + sum(v >= 1 - margin for v in (x1, y1))
    not_cut = 1.0 - min(cut, 2) / 2
    if look.face_h is not None:
        not_cut = min(not_cut, 1.0 if y0 > 0.03 else 0.4)  # no headroom: the head touches the top
    size = min(look.area / 0.06, 1.0) if look.face_h is None else min(look.face_h / 0.08, 1.0)
    score = 0.35 * max(place_y, 0.0) + 0.1 * max(place_x, 0.0) + 0.3 * not_cut + 0.25 * size
    return round(float(min(max(score, 0.0), 1.0)), 3)


def subject_value(look: FrameLook) -> float:
    """How clearly one subject dominates (0..1): a face, or a salient object of a readable size."""
    if look.empty or look.subject is None:
        return 0.0
    if look.face_h is not None:
        return round(min(0.6 + look.face_h * 1.5, 1.0), 3)
    size = min(look.area / 0.15, 1.0) * (1.0 if look.area < 0.85 else 0.5)  # filling everything is a texture, not a subject
    stands_out = min(max((look.focus - 0.9) / 0.6, 0.2), 1.0)  # no sharper than its surroundings -> barely a subject
    return round(float(look.subject_strength * (0.4 + 0.6 * size) * stands_out), 3)


def subject_motion(prev: np.ndarray, cur: np.ndarray, shift_px: tuple[float, float] | None) -> float:
    """Movement left after compensating the camera's global shift (mean absolute difference, 0..1 raw)."""
    if shift_px is not None:
        m = np.float32([[1, 0, shift_px[0]], [0, 1, shift_px[1]]])
        prev = cv2.warpAffine(prev, m, (prev.shape[1], prev.shape[0]), borderMode=cv2.BORDER_REPLICATE)
    h, w = cur.shape
    by, bx = max(int(h * 0.06), 1), max(int(w * 0.06), 1)  # ignore the border the shift pulls in
    return float(cv2.absdiff(prev, cur)[by:-by, bx:-bx].mean() / 255.0)


def camera_score(shift: tuple[float, float] | None, dt: float) -> float:
    """0..1 from the global shift (share of the frame per sample): ~30% of the frame per second reads as a fast move."""
    if shift is None or dt <= 0:
        return 0.0
    speed = math.hypot(*shift) / dt
    return round(float(1.0 - math.exp(-speed / 0.12)), 3)
