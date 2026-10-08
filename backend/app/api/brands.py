"""Brand profiles: identity (logo, colours, fonts, CTA) plus defaults (language, voice, tone, caption/transition style)."""

from __future__ import annotations

from typing import Literal

import cv2
import numpy as np
from bson import ObjectId
from fastapi import APIRouter, File, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import Field

from app.core.database import get_db
from app.core.errors import NotFoundError, UnsupportedMedia, ValidationFailed
from app.models.base import CamelModel, utcnow
from app.models.timeline import Timeline, Watermark
from app.schemas.project import CaptionStyle, Pace
from app.services import project_service as ps
from app.services import timeline_service as ts
from app.services.ids import parse_id
from app.storage import get_storage
from app.styles import validate_style_id
from app.video.presets import validate_preset_id
from app.video.timeline_ops import AddCaption, ClearWatermark, SetCaptionLook, SetCaptionStyle, SetWatermark

router = APIRouter(tags=["brands"])
HEX = r"^#[0-9A-Fa-f]{6}$"
MAX_LOGO_BYTES = 5 * 1024 * 1024
LOGO_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


class BrandColors(CamelModel):
    primary: str = Field(default="#FFFFFF", pattern=HEX)
    secondary: str = Field(default="#000000", pattern=HEX)
    accent: str = Field(default="#8B5CF6", pattern=HEX)


class BrandWatermark(CamelModel):
    enabled: bool = True
    position: Literal["br", "bl", "tr", "tl", "center"] = "br"
    opacity: float = Field(default=0.85, ge=0.05, le=1)
    scale: float = Field(default=0.16, ge=0.04, le=0.6)


class BrandIn(CamelModel):
    name: str = Field(min_length=1, max_length=80)
    colors: BrandColors = BrandColors()
    caption_font: str | None = Field(default=None, max_length=60)
    heading_font: str | None = Field(default=None, max_length=60)
    watermark: BrandWatermark = BrandWatermark()
    cta: str = Field(default="", max_length=100)
    language: Literal["en", "hi", "mr", "hinglish"] = "en"
    voice_profile_id: str | None = None
    script_tone: str = Field(default="", max_length=80)
    caption_style: CaptionStyle = "minimal"
    style: str = "auto"
    # The brand's look for the Creative Director (one of the built-in styles); used whenever a project's style is auto.
    visual_style: Literal["luxury", "cinematic", "viral", "minimal", "energetic", "storytelling", "product_focus", "social_native"] | None = None
    pace: Pace = "balanced"
    trend_id: str | None = None
    music_style: str = Field(default="", max_length=100)  # free text guidance ("warm acoustic", "upbeat house")
    export_preset: str = "instagram_reel"


def _out(d: dict) -> dict:
    keys = ("name", "colors", "captionFont", "headingFont", "watermark", "cta", "language", "voiceProfileId", "scriptTone",
            "captionStyle", "style", "visualStyle", "pace", "trendId", "musicStyle", "exportPreset")  # fmt: skip
    return {"id": str(d["_id"]), **{k: d.get(k) for k in keys}, "hasLogo": bool(d.get("logoKey")),
            "logoUrl": f"/api/brands/{d['_id']}/logo" if d.get("logoKey") else None, "createdAt": d.get("createdAt")}  # fmt: skip


def _check(p: BrandIn) -> None:
    validate_style_id(p.style)
    validate_preset_id(p.export_preset)


@router.get("/api/brands")
async def list_brands():
    return [_out(d) async for d in get_db().brands.find({}).sort("createdAt", -1)]


@router.post("/api/brands", status_code=201)
async def create_brand(payload: BrandIn):
    _check(payload)
    doc = {"_id": ObjectId(), **payload.to_doc(), "logoKey": None, "createdAt": utcnow()}
    await get_db().brands.insert_one(doc)
    return _out(doc)


@router.get("/api/brands/{brand_id}")
async def get_brand(brand_id: str):
    d = await get_db().brands.find_one({"_id": parse_id(brand_id, "Brand")})
    if not d:
        raise NotFoundError("Brand not found.", code="BRAND_NOT_FOUND")
    return _out(d)


@router.patch("/api/brands/{brand_id}")
async def update_brand(brand_id: str, payload: BrandIn):
    _check(payload)
    oid = parse_id(brand_id, "Brand")
    if not await get_db().brands.find_one({"_id": oid}):
        raise NotFoundError("Brand not found.", code="BRAND_NOT_FOUND")
    await get_db().brands.update_one({"_id": oid}, {"$set": payload.to_doc()})
    return _out(await get_db().brands.find_one({"_id": oid}))


@router.delete("/api/brands/{brand_id}", status_code=204)
async def delete_brand(brand_id: str):
    oid = parse_id(brand_id, "Brand")
    get_storage().delete_prefix(f"brands/{oid}")
    await get_db().brands.delete_one({"_id": oid})
    await get_db().projects.update_many({"settings.brandId": str(oid)}, {"$set": {"settings.brandId": None}})
    return Response(status_code=204)


@router.post("/api/brands/{brand_id}/logo")
async def upload_logo(brand_id: str, file: UploadFile = File(...)):
    oid = parse_id(brand_id, "Brand")
    if not await get_db().brands.find_one({"_id": oid}):
        raise NotFoundError("Brand not found.", code="BRAND_NOT_FOUND")
    name = (file.filename or "").lower()
    if not any(name.endswith(e) for e in LOGO_EXTS):
        raise UnsupportedMedia("The logo must be a PNG, JPG or WEBP image.", details={"allowed": sorted(LOGO_EXTS)})
    data = await file.read(MAX_LOGO_BYTES + 1)
    if len(data) > MAX_LOGO_BYTES:
        raise ValidationFailed("The logo is larger than 5 MB.", code="FILE_TOO_LARGE")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)  # proves it really is an image
    if img is None or img.ndim < 2 or min(img.shape[:2]) < 16:
        raise UnsupportedMedia("That file is not a usable image.", code="INVALID_IMAGE")
    h, w = img.shape[:2]
    if max(h, w) > 1200:  # a logo never needs to be bigger; keeps overlays cheap
        s = 1200 / max(h, w)
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    ok, png = cv2.imencode(".png", img)
    if not ok:
        raise UnsupportedMedia("The image could not be processed.", code="INVALID_IMAGE")
    key = f"brands/{oid}/logo.png"
    get_storage().write_bytes(key, png.tobytes())
    await get_db().brands.update_one({"_id": oid}, {"$set": {"logoKey": key}})
    return _out(await get_db().brands.find_one({"_id": oid}))


@router.get("/api/brands/{brand_id}/logo")
async def get_logo(brand_id: str):
    d = await get_db().brands.find_one({"_id": parse_id(brand_id, "Brand")})
    if not d or not d.get("logoKey") or not get_storage().exists(d["logoKey"]):
        raise NotFoundError("This brand has no logo.", code="LOGO_NOT_FOUND")
    return FileResponse(get_storage().local_path(d["logoKey"]), media_type="image/png")


class ApplyBrand(CamelModel):
    brand_id: str
    to_timeline: bool = True  # also restyle the existing edit (captions, watermark, CTA)


@router.post("/api/projects/{project_id}/apply-brand")
async def apply_brand(project_id: str, payload: ApplyBrand):
    """Make a project follow a brand: defaults for new renders, and (optionally) the current edit."""
    doc = await ts.load(project_id)
    b = await get_db().brands.find_one({"_id": parse_id(payload.brand_id, "Brand")})
    if not b:
        raise NotFoundError("Brand not found.", code="BRAND_NOT_FOUND")
    patch = {"settings.brandId": str(b["_id"]), "settings.language": b["language"], "settings.captionStyle": b["captionStyle"],
             "settings.pace": b["pace"], "settings.exportPreset": b["exportPreset"], "settings.style": b["style"],
             "settings.trendId": b.get("trendId"), "updatedAt": utcnow()}  # fmt: skip
    if b.get("voiceProfileId"):
        patch["settings.voiceProfileId"] = b["voiceProfileId"]
    script = doc.get("script") or {"language": b["language"], "lines": []}
    patch["script"] = {**script, "language": b["language"], "tone": b.get("scriptTone", "") or script.get("tone", ""),
                       "cta": b.get("cta") or script.get("cta")}  # fmt: skip
    await get_db().projects.update_one({"_id": doc["_id"]}, {"$set": patch})

    state = None
    if payload.to_timeline and doc.get("timeline"):
        tl = Timeline.model_validate(ts.state_of(doc)["timeline"])
        ops: list = [SetCaptionStyle(style=b["captionStyle"]),
                     SetCaptionLook(font=b.get("captionFont") or "", color=b["colors"]["primary"])]  # fmt: skip
        wm, logo = b.get("watermark") or {}, b.get("logoKey")
        if wm.get("enabled") and logo:
            ops.append(SetWatermark(watermark=Watermark(logo_key=logo, position=wm["position"], opacity=wm["opacity"], scale=wm["scale"])))
        else:
            ops.append(ClearWatermark())
        cta = (b.get("cta") or "").strip()
        if cta and not any(c.text == cta for c in tl.captions) and tl.duration > 3:
            ops.append(AddCaption(start=round(tl.duration - 2.4, 2), end=round(tl.duration - 0.2, 2), text=cta))
        state = await ts.apply(project_id, ops, f"Brand: {b['name']}")
    return {"brand": _out(b), "state": state, "settings": (await ps.get_project_doc(project_id))["settings"]}
