"""Health + catalogue endpoints (styles)."""

from __future__ import annotations

import re
import socket
from dataclasses import asdict

import asyncio

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from app.core.admin import require_admin
from app.models.base import CamelModel
from fastapi.responses import HTMLResponse

from app.ai.provider import get_provider
from app.core.config import PRIVATE_NETWORK_ORIGIN, get_settings
from app.core.errors import AppError
from app.core.database import get_db
from app.core.ffmpeg import ffmpeg_available
from app.styles import list_styles

router = APIRouter(prefix="/api", tags=["system"])
check_router = APIRouter(tags=["system"])


@router.get("/health")
async def health():
    s = get_settings()
    try:
        await get_db().command("ping")
        mongo = True
    except Exception:  # noqa: BLE001 - health check must never raise
        mongo = False
    from app.ai.ai_config import effective

    provider_name, local, fallback = effective().text_provider or s.ai_provider, True, None
    try:
        p = get_provider()
        local = p.is_local
        fallback = p.get_model_info().get("fallback")
        ai = await asyncio.to_thread(p.health)
    except AppError as exc:
        ai = {"available": False, "model": None, "detail": exc.message}
    return {
        "status": "ok" if mongo and ffmpeg_available() else "degraded",
        "mongodb": mongo,
        "ffmpeg": ffmpeg_available(),
        # "local": nothing leaves this computer (Ollama); False = cloud AI (only compact metadata/keyframes are sent)
        "ai": {"provider": provider_name, "local": local, "fallback": fallback, **ai},
    }


def lan_addresses() -> list[str]:
    """This computer's private network addresses, the one used for Wi-Fi/Ethernet first."""
    found: list[str] = []
    try:  # the address the operating system would use to reach the local network (no packet is actually sent)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            found.append(sock.getsockname()[0])
    except OSError:
        pass
    try:
        found += [str(i[4][0]) for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
    except OSError:
        pass
    out: list[str] = []
    for ip in found:
        if ip not in out and re.match(PRIVATE_NETWORK_ORIGIN, f"http://{ip}"):
            out.append(ip)
    return out


@router.get("/admin/session")
async def admin_session(request: Request):
    """Whether this browser is in admin mode (``required`` = an admin key is configured on the server)."""
    from app.core.admin import admin_required, is_admin

    return {"admin": is_admin(request), "required": admin_required()}


class RetentionIn(CamelModel):
    enabled: bool
    uploads_hours: int = Field(ge=1, le=24 * 90)
    projects_hours: int = Field(ge=1, le=24 * 90)


@router.get("/site")
async def site():
    """The business details for the legal and contact pages (public)."""
    s = get_settings()
    return {"businessName": s.business_name, "supportEmail": s.support_email, "supportPhone": s.support_phone,
            "businessAddress": s.business_address, "legalUpdated": s.legal_updated}  # fmt: skip


@router.get("/plans")
async def plans():
    """Plans, credits and prices (public: the pricing page is shown before sign-in)."""
    from app.services.plans import pricing

    return await pricing()


@router.get("/retention")
async def retention():
    """How long uploads and projects are kept (shown to users so they download in time)."""
    from app.services.retention import get_retention

    return await get_retention()


@router.put("/admin/retention", dependencies=[Depends(require_admin)])
async def set_retention(payload: RetentionIn):
    from app.services.retention import set_retention as save

    return await save(payload.enabled, payload.uploads_hours, payload.projects_hours)


@router.post("/admin/retention/run", dependencies=[Depends(require_admin)])
async def run_retention():
    """Run the auto-delete now (it also runs by itself every 10 minutes)."""
    from app.services.retention import sweep

    return await sweep()


@router.get("/phone")
async def phone():
    """For the "send from your phone" card: is phone mode on, and which address should the phone open."""
    return {"enabled": get_settings().cors_allow_lan, "addresses": lan_addresses()}


@router.get("/styles")
async def styles():
    items = [
        {"id": st.id, "name": st.name, "description": st.description,
         "captionStyle": st.caption_style, "cutPace": {"high": st.cut_beats_high, "low": st.cut_beats_low}}
        for st in list_styles()
    ]  # fmt: skip
    items.append({"id": "auto", "name": "Auto", "captionStyle": "minimal", "cutPace": None,
                  "description": "Picks a style from the music and footage (uses AI assist when it is on)."})
    return items


@router.get("/trends")
async def trends():
    """Trend presets (manual for now). Camel-case, matching the trend JSON in the product spec."""
    from app.trends.manual import get_trend_source

    return [t.to_doc() for t in get_trend_source().list_trends()]


@router.get("/styles/{style_id}")
async def style_detail(style_id: str):
    from app.styles import get_style

    return asdict(get_style(style_id))


_CHECK_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phone check</title><style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:20px;background:#0f0f14;color:#eee}
.ok{color:#4ade80}.bad{color:#f87171}.mut{color:#9ca3af;font-size:14px}code{background:#1f2937;padding:2px 6px;border-radius:6px}
.card{background:#181822;border:1px solid #2a2a3a;border-radius:14px;padding:16px;margin:12px 0}
</style></head><body>
<h1>Phone check</h1>
<div class="card"><b class="ok">&#10003; Your phone reached this computer.</b>
<p class="mut">The API port (8000) is open to your phone. The computer saw your phone at <code>__CLIENT__</code>.</p></div>
<div class="card"><b>App page (port 3100)</b><p id="app" class="mut">Checking&hellip;</p></div>
<p class="mut">Then open the app: <a id="link" style="color:#a78bfa" href="#">the app</a></p>
<p class="mut">Browser: __UA__</p>
<script>
var host = location.hostname, appUrl = "http://" + host + ":3100/";
document.getElementById("link").href = appUrl; document.getElementById("link").textContent = appUrl;
var c = new AbortController(), t = setTimeout(function(){ c.abort(); }, 8000);
fetch(appUrl, {mode: "no-cors", signal: c.signal}).then(function(){
  clearTimeout(t); document.getElementById("app").innerHTML = '<span class="ok">&#10003; Reachable.</span> If the app still shows a blank page, tell the developer: the network is fine and the problem is in the page.';
}).catch(function(){
  clearTimeout(t); document.getElementById("app").innerHTML = '<span class="bad">&#10007; Not reachable.</span> Port 3100 (the app) is blocked or not running. Run the phone-mode script on the computer again.';
});
</script></body></html>"""


@check_router.get("/phone-check", response_class=HTMLResponse)
async def phone_check(request: Request):
    """A tiny page (no app code) that shows whether a phone can reach this computer, and the app port too."""
    import html

    client = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")[:160]
    return HTMLResponse(_CHECK_PAGE.replace("__CLIENT__", html.escape(client)).replace("__UA__", html.escape(ua)), headers={"Cache-Control": "no-store"})
