"""Understand a product photo before planning anything.

Finds the product (its outline), where the fine detail is (for close-ups and macro shots), which spots are truly reflective
(the only places sparkles may appear), the colours, and whether the picture is technically good enough to zoom into.
Classical image analysis (OpenCV): fast, offline, deterministic. It says how sure it is, instead of guessing silently.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from app.core.errors import CorruptedMedia
from app.product.models import Highlight, ImageUnderstanding, Rect, Region

ANALYSIS_SIDE = 720  # long side used for analysis; the original is never altered


def load_bgr(path: Path) -> np.ndarray:
    """Read a photo as BGR. OpenCV applies the camera's EXIF rotation, so phone photos come out upright."""
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None or img.size == 0 or img.shape[0] < 16 or img.shape[1] < 16:
        raise CorruptedMedia("The image could not be read (or is too small to use).", code="CORRUPTED_IMAGE")
    return img


def _hex(bgr: np.ndarray) -> str:
    b, g, r = (int(round(float(v))) for v in bgr)
    return f"#{r:02X}{g:02X}{b:02X}"


def _ring(h: int, w: int) -> np.ndarray:
    t = max(2, int(0.04 * min(h, w)))
    m = np.zeros((h, w), bool)
    m[:t], m[-t:], m[:, :t], m[:, -t:] = True, True, True, True
    return m


def _bbox_of_components(mask: np.ndarray, keep_ratio: float = 0.08) -> tuple[int, int, int, int] | None:
    """Bounding box (x0, y0, x1, y1) of the big blobs of a mask (small specks are ignored)."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 1:
        return None
    areas = stats[1:, cv2.CC_STAT_AREA]
    biggest = int(areas.max())
    floor = max(keep_ratio * biggest, 0.003 * mask.size)
    boxes = [(s[cv2.CC_STAT_LEFT], s[cv2.CC_STAT_TOP], s[cv2.CC_STAT_LEFT] + s[cv2.CC_STAT_WIDTH], s[cv2.CC_STAT_TOP] + s[cv2.CC_STAT_HEIGHT])
             for s, a in zip(stats[1:], areas) if a >= floor]  # fmt: skip
    if not boxes:
        return None
    return min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)


def understand_image(path: Path, media_id: str, name: str = "") -> ImageUnderstanding:
    img = load_bgr(path)
    H, W = img.shape[:2]
    k = ANALYSIS_SIDE / max(H, W)
    small = cv2.resize(img, (max(int(W * k), 16), max(int(H * k), 16)), interpolation=cv2.INTER_AREA) if k < 1 else img.copy()
    h, w = small.shape[:2]
    notes: list[str] = []

    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    ring = _ring(h, w)
    ring_px = lab[ring]
    bg_lab = np.median(ring_px, axis=0)
    spread = float(np.mean(np.std(ring_px, axis=0)))
    plain = spread < 14.0
    bg_bgr = np.median(small[ring], axis=0)
    dark = float(cv2.cvtColor(np.uint8([[bg_bgr]]), cv2.COLOR_BGR2GRAY)[0, 0]) < 90

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    if plain:
        dist = np.linalg.norm(lab - bg_lab, axis=2)
        d8 = np.clip(dist * 4, 0, 255).astype(np.uint8)
        otsu, _ = cv2.threshold(d8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        mask = dist > max(float(otsu) / 4, 16.0)
        notes.append("Plain background: the product's outline is reliable.")
    else:
        # busy picture: the subject is what stands out from the centre, by detail
        gx, gy = cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1)
        sal = cv2.GaussianBlur(cv2.magnitude(gx, gy), (0, 0), max(h, w) / 60)
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        sal *= np.exp(-(((xx / w - 0.5) / 0.45) ** 2 + ((yy / h - 0.5) / 0.45) ** 2))
        mask = sal > np.percentile(sal, 70)
        notes.append("Busy background: the product's outline is an estimate, so close-ups stay closer to the centre.")

    ksz = max(3, int(min(h, w) / 90) | 1)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((ksz, ksz), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((ksz * 3, ksz * 3), np.uint8)).astype(bool)

    box = _bbox_of_components(mask)
    confidence = 0.9 if plain else 0.4
    if box is not None:
        x0, y0, x1, y1 = box
        area = (x1 - x0) * (y1 - y0) / (w * h)
        if not 0.02 <= area <= 0.97:
            box = None
    if box is None:
        x0, y0, x1, y1 = int(0.12 * w), int(0.12 * h), int(0.88 * w), int(0.88 * h)
        mask = np.zeros((h, w), bool)
        mask[y0:y1, x0:x1] = True
        confidence = 0.2
        notes.append("The product could not be outlined confidently; the centre of the photo is used.")
    pad = 0.03
    subject = Rect(x=max(x0 / w - pad, 0.0), y=max(y0 / h - pad, 0.0), w=0.0, h=0.0)
    subject.w = min((x1 - x0) / w + 2 * pad, 1.0 - subject.x)
    subject.h = min((y1 - y0) / h + 2 * pad, 1.0 - subject.y)

    # ---- where the fine detail is
    lap = np.abs(cv2.Laplacian(cv2.GaussianBlur(gray, (0, 0), 1.0), cv2.CV_32F))
    lap = cv2.GaussianBlur(lap, (0, 0), 2.0)
    sx0, sy0 = int(subject.x * w), int(subject.y * h)
    sx1, sy1 = int((subject.x + subject.w) * w), int((subject.y + subject.h) * h)
    n = 8
    tiles: list[tuple[float, float, float]] = []
    for j in range(n):
        for i in range(n):
            ty0, ty1 = sy0 + (sy1 - sy0) * j // n, sy0 + (sy1 - sy0) * (j + 1) // n
            tx0, tx1 = sx0 + (sx1 - sx0) * i // n, sx0 + (sx1 - sx0) * (i + 1) // n
            if ty1 <= ty0 or tx1 <= tx0:
                continue
            cover = float(mask[ty0:ty1, tx0:tx1].mean())
            score = float(lap[ty0:ty1, tx0:tx1].mean()) * (0.35 + 0.65 * cover)
            tiles.append((score, (tx0 + tx1) / 2 / w, (ty0 + ty1) / 2 / h))
    tiles.sort(reverse=True)
    top = tiles[0][0] if tiles and tiles[0][0] > 0 else 1.0
    side_px = 0.3 * max((sx1 - sx0), (sy1 - sy0)) / k if k < 1 else 0.3 * max(sx1 - sx0, sy1 - sy0)
    regions: list[Region] = []
    min_gap = 1.3 * max(sx1 - sx0, sy1 - sy0) / (w * n)  # in fractions of the width
    for score, cx, cy in tiles:
        if len(regions) >= 5:
            break
        if any(abs(cx - r.rect.cx) < min_gap and abs(cy - r.rect.cy) * h / w < min_gap for r in regions):
            continue
        rw, rh = side_px / W, side_px / H
        rect = Rect(x=min(max(cx - rw / 2, 0.0), 1 - rw), y=min(max(cy - rh / 2, 0.0), 1 - rh), w=min(rw, 1.0), h=min(rh, 1.0))
        rel = score / top
        regions.append(Region(rect=rect, score=round(rel, 3), kind="macro" if rel >= 0.7 else "detail"))

    # ---- reflective highlights (stones, glints on metal): the only places sparkles are allowed
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    v, s = hsv[..., 2].astype(np.float32), hsv[..., 1]
    local = v - cv2.GaussianBlur(v, (0, 0), max(h, w) / 40)
    inside = cv2.dilate(mask.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    box_mask = np.zeros((h, w), bool)
    box_mask[sy0:sy1, sx0:sx1] = True
    inside &= box_mask  # a glint only counts on the product's outline, never on a stray bright spot beside it
    spec = (v >= 225) & (s <= 80) & (local > 22) & inside
    cnt, _, stats, cents = cv2.connectedComponentsWithStats(spec.astype(np.uint8), connectivity=8)
    cand: list[tuple[float, float, float]] = []
    for c in range(1, cnt):
        area = stats[c, cv2.CC_STAT_AREA]
        if area < 2 or area > 0.006 * w * h:
            continue
        x, y, bw, bh = (stats[c, cv2.CC_STAT_LEFT], stats[c, cv2.CC_STAT_TOP], stats[c, cv2.CC_STAT_WIDTH], stats[c, cv2.CC_STAT_HEIGHT])
        contrast = float(np.clip(local[y : y + bh, x : x + bw].max() / 90.0, 0, 1))
        strength = 0.55 * contrast + 0.45 * float(v[y : y + bh, x : x + bw].max() / 255.0)
        cand.append((strength, cents[c][0] / w, cents[c][1] / h))
    cand.sort(reverse=True)
    highlights: list[Highlight] = []
    for strength, cx, cy in cand:
        if len(highlights) >= 12:
            break
        if all(abs(cx - hl.x) > 0.03 or abs(cy - hl.y) * h / w > 0.03 for hl in highlights):
            highlights.append(Highlight(x=round(cx, 4), y=round(cy, 4), strength=round(min(strength, 1.0), 3)))
    if not highlights:
        notes.append("No reflective highlights were found, so sparkles will not be used on this photo.")

    # ---- colours of the product
    cv2.setRNGSeed(0)
    px = small[mask]
    palette: list[str] = []
    if len(px) >= 30:
        sample = px[:: max(len(px) // 4000, 1)].astype(np.float32)
        _, lbl, centers = cv2.kmeans(sample, 3, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0), 1, cv2.KMEANS_PP_CENTERS)
        order = np.argsort(-np.bincount(lbl.ravel(), minlength=3))
        palette = [_hex(centers[i]) for i in order]

    sharp = float(np.log1p(cv2.Laplacian(gray[sy0:sy1, sx0:sx1], cv2.CV_32F).var())) if sx1 > sx0 and sy1 > sy0 else 0.0
    if max(H, W) < 1200:
        notes.append(f"The photo is {W}x{H}: close-ups and macro shots are limited to stay sharp.")
    return ImageUnderstanding(
        media_id=media_id, name=name, width=W, height=H, subject=subject, subject_confidence=round(confidence, 2),
        background="plain" if plain else "busy", background_color=_hex(bg_bgr), dark_background=dark, palette=palette,
        regions=regions, highlights=highlights, sharpness=round(sharp, 2), notes=notes,
    )  # fmt: skip
