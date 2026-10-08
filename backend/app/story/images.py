"""Pictures for story scenes, cheapest source first:

1. **library**: a picture made or found earlier for the same description (shared by every user; it grows by itself)
2. **public_domain**: classical paintings on Wikimedia Commons whose licence is public domain (Raja Ravi Varma...)
3. **free_ai**: Cloudflare Workers AI, FLUX.1-schnell (a free daily allowance: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)
4. **paid_ai**: only when the admin switches it on (STORY_PAID_IMAGES = gemini | openai)

Users' own uploads are never put in the shared library. Every source returns JPEG/PNG bytes; nothing here renders.
"""

from __future__ import annotations

import base64
import hashlib
import html
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import get_settings
from app.story.models import ART_STYLES, StoryPlan, StoryScene

log = logging.getLogger(__name__)
COMMONS = "https://commons.wikimedia.org/w/api.php"


class NoPicture(Exception):
    """No source could give a picture for this scene."""


@dataclass
class Picture:
    data: bytes
    ext: str  # "jpg" | "png"
    source: str
    credit: str = ""
    library_id: str | None = None  # set when it came from (or was saved to) the shared library
    ref: str = ""  # the source's own id (to skip it on "Another picture")


def prompt_for(plan: StoryPlan, scene: StoryScene) -> str:
    """What an image model is asked for: the style, the scene, and the fixed look of every character in it."""
    style = ART_STYLES[plan.art_style]
    looks = [f"{c.name}: {c.look}" for c in plan.characters if c.look and (c.name in scene.characters or c.name.lower() in scene.visual.lower())]
    framing = {"wide": "wide shot", "medium": "medium shot", "close": "close-up"}[scene.shot]
    parts = [f"{style.prompt}.", f"{framing}: {scene.visual}"]
    if looks:
        parts.append("Characters: " + "; ".join(looks) + ".")
    parts.append("Vertical 9:16 composition, subject in the centre. No text, no letters, no captions, no watermark, no modern objects.")
    return " ".join(parts)[:2000]


def library_key(art_style: str, scene: StoryScene) -> str:
    norm = re.sub(r"[^a-z0-9 ]+", "", scene.visual.lower())
    return hashlib.sha1(f"{art_style}|{' '.join(norm.split())}|{','.join(sorted(scene.characters))}".encode()).hexdigest()[:24]


def _ext(data: bytes) -> str:
    return "png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "jpg"


# ----------------------------------------------------------------------------- 2. public-domain paintings
def _plain(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def user_agent() -> str:
    """Wikimedia refuses clients that do not say who they are: this studio's address and a contact."""
    s = get_settings()
    site = s.public_base_url or "https://github.com/ai-reel-maker"
    contact = f"; {s.contact_email}" if s.contact_email else ""
    return f"AIReelMaker/1.0 ({site}{contact})"


def commons_search(scene: StoryScene, skip: set[str], client: httpx.Client) -> Picture | None:
    """A public-domain painting on Wikimedia Commons matching the scene's names (Raja Ravi Varma first)."""
    words = [k for k in scene.keywords if k][:3] or scene.characters[:2]
    if not words:
        return None
    # what the painting should mention: the people first (they matter most), then the other keywords
    wanted = {w.lower(): (2.0 if w in scene.characters or w[:1].isupper() else 1.0) for w in [*scene.characters, *scene.keywords] if w}
    best: tuple[float, dict, dict, str] | None = None
    for query in (f'"Ravi Varma" {" ".join(words)}', f"{' '.join(words)} painting"):
        r = client.get(COMMONS, headers={"User-Agent": user_agent()}, timeout=20, params={
            "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 15,
            "gsrsearch": f"{query} filetype:bitmap", "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 1600})  # fmt: skip
        r.raise_for_status()
        pages = sorted((r.json().get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
        for rank, p in enumerate(pages):
            info = (p.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata") or {}
            licence = _plain((meta.get("LicenseShortName") or {}).get("value", "")).lower()
            title = p.get("title", "")
            if title in skip or not ("public domain" in licence or licence.startswith("pd")):
                continue
            if min(info.get("width", 0), info.get("height", 0)) < 600:
                continue
            about = (title + " " + _plain((meta.get("ImageDescription") or {}).get("value", ""))).lower()
            score = sum(w for k, w in wanted.items() if k in about)
            if score <= 0:
                continue  # the painting must at least mention one of the scene's names
            score -= rank * 0.05  # among equals, the search engine's order
            if best is None or score > best[0]:
                best = (score, info, meta, title)
        if best and best[0] >= 3.5:
            break  # a painting with two of the scene's people: no need for the broader search
    if best is None:
        return None
    _, info, meta, title = best
    img = client.get(info.get("thumburl") or info["url"], headers={"User-Agent": user_agent()}, timeout=60)
    img.raise_for_status()
    artist = (_plain((meta.get("Artist") or {}).get("value", "")).splitlines() or [""])[0].strip()
    half = len(artist) // 2
    if half and artist[:half] == artist[half:]:  # some pages repeat the name in hidden markup
        artist = artist[:half]
    artist = artist[:80] or "Unknown artist"
    return Picture(img.content, _ext(img.content), "public_domain", f"{artist} · Wikimedia Commons (public domain)", ref=title)


# ----------------------------------------------------------------------------- 3. free AI (Cloudflare)
def cloudflare_ready() -> bool:
    s = get_settings()
    return bool(s.cloudflare_account_id and s.cloudflare_api_token.get_secret_value())


def cloudflare_flux(prompt: str, client: httpx.Client) -> Picture:
    s = get_settings()
    r = client.post(
        f"https://api.cloudflare.com/client/v4/accounts/{s.cloudflare_account_id}/ai/run/@cf/black-forest-labs/flux-1-schnell",
        headers={"Authorization": f"Bearer {s.cloudflare_api_token.get_secret_value()}"}, json={"prompt": prompt[:2048], "steps": 6}, timeout=120,
    )  # fmt: skip
    if r.status_code != 200:
        raise NoPicture(f"The free picture service refused the request ({r.status_code}): {r.text[:160]}")
    data = base64.b64decode(r.json()["result"]["image"])
    return Picture(data, _ext(data), "free_ai", "AI picture (FLUX.1 schnell)")


# ----------------------------------------------------------------------------- 4. paid AI (admin opt-in)
def paid_ready() -> str:
    s = get_settings()
    if s.story_paid_images == "gemini" and s.gemini_api_key.get_secret_value():
        return "gemini"
    if s.story_paid_images == "openai" and s.openai_api_key.get_secret_value():
        return "openai"
    return ""


def paid_picture(prompt: str, client: httpx.Client) -> Picture:
    s = get_settings()
    which = paid_ready()
    if which == "gemini":
        r = client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{s.gemini_image_model}:generateContent",
                        params={"key": s.gemini_api_key.get_secret_value()}, timeout=180,
                        json={"contents": [{"parts": [{"text": prompt}]}],
                              "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16"}}})  # fmt: skip
        if r.status_code != 200:
            raise NoPicture(f"The paid picture service refused the request ({r.status_code}).")
        part = next((p for p in r.json()["candidates"][0]["content"]["parts"] if "inlineData" in p), None)
        if not part:
            raise NoPicture("The paid picture service returned no picture.")
        data = base64.b64decode(part["inlineData"]["data"])
    else:
        r = client.post("https://api.openai.com/v1/images/generations", timeout=180,
                        headers={"Authorization": f"Bearer {s.openai_api_key.get_secret_value()}"},
                        json={"model": s.openai_image_model, "prompt": prompt, "size": "1024x1536", "quality": "medium", "n": 1})  # fmt: skip
        if r.status_code != 200:
            raise NoPicture(f"The paid picture service refused the request ({r.status_code}).")
        data = base64.b64decode(r.json()["data"][0]["b64_json"])
    return Picture(data, _ext(data), "paid_ai", f"AI picture ({which})")


# ----------------------------------------------------------------------------- the chain
def sources_available(art_style: str) -> list[str]:
    out = ["library"]
    if ART_STYLES[art_style].paintings:
        out.append("public_domain")
    if cloudflare_ready():
        out.append("free_ai")
    if paid_ready():
        out.append("paid_ai")
    return out


def find_picture(plan: StoryPlan, scene: StoryScene, library: Any, skip: set[str]) -> Picture:
    """The cheapest picture for a scene that it has not shown yet. ``library`` looks up / remembers shared pictures
    (``get(key, skip) -> Picture | None``); generated pictures are added to it by the caller."""
    errors: list[str] = []
    key = library_key(plan.art_style, scene)
    hit = library.get(key, plan.art_style, scene, skip)
    if hit:
        return hit
    with httpx.Client() as client:
        if ART_STYLES[plan.art_style].paintings:
            try:
                pic = commons_search(scene, skip, client)
                if pic:
                    return pic
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                errors.append(f"paintings: {exc}")
        prompt = prompt_for(plan, scene)
        for name, ready, make in (("free AI", cloudflare_ready, cloudflare_flux), ("paid AI", paid_ready, paid_picture)):
            if not ready():
                continue
            try:
                return make(prompt, client)
            except (NoPicture, httpx.HTTPError, ValueError, KeyError) as exc:
                errors.append(f"{name}: {exc}")
    if not cloudflare_ready() and not paid_ready():
        raise NoPicture("No more pictures for this scene. Upload your own picture, or ask the admin to connect the free AI "
                        "pictures (Cloudflare).")  # fmt: skip
    raise NoPicture("Could not get a picture for this scene right now. Try again, or upload your own. " + " · ".join(errors)[:300])
