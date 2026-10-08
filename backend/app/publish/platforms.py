"""The three platform connectors. Each takes the Reel as a public, signed, short-lived link (the platforms fetch the
file themselves; YouTube is uploaded directly) and returns the post's id / link. Errors carry the platform's message."""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.core.config import get_settings

GRAPH = "https://graph.facebook.com/v21.0"


class PublishError(Exception):
    pass


@dataclass
class Posted:
    post_id: str
    url: str = ""


def connections() -> dict[str, dict]:
    """Which platforms are connected, and what is missing for the others (names of .env settings, never values)."""
    s = get_settings()
    need = {
        "instagram": [n for n, v in (("INSTAGRAM_USER_ID", s.instagram_user_id), ("INSTAGRAM_ACCESS_TOKEN", s.instagram_access_token.get_secret_value())) if not v],
        "tiktok": [n for n, v in (("TIKTOK_ACCESS_TOKEN", s.tiktok_access_token.get_secret_value()),) if not v],
        "youtube": [n for n, v in (("YOUTUBE_CLIENT_ID", s.youtube_client_id), ("YOUTUBE_CLIENT_SECRET", s.youtube_client_secret.get_secret_value()),
                                   ("YOUTUBE_REFRESH_TOKEN", s.youtube_refresh_token.get_secret_value())) if not v],
    }  # fmt: skip
    link = [] if s.public_base_url else ["PUBLIC_BASE_URL"]
    for p in ("instagram", "tiktok"):  # these two fetch the video from a public link
        need[p] += link
    if not s.secret_key.get_secret_value():
        need["instagram"] += ["SECRET_KEY"]
        need["tiktok"] += ["SECRET_KEY"]
    return {p: {"connected": not missing, "missing": missing} for p, missing in need.items()}


def _check(r: httpx.Response, platform: str) -> dict:
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400 or (isinstance(data, dict) and data.get("error") and platform != "tiktok"):
        err = data.get("error") if isinstance(data, dict) else None
        msg = (err.get("message") if isinstance(err, dict) else err) or r.text[:200]
        raise PublishError(f"{platform.title()} said: {msg}")
    return data


def post_instagram(video_url: str, caption: str, client: httpx.Client, wait: float = 300, poll: float = 5) -> Posted:
    """Meta Graph API: create a REELS container from the link, wait until Instagram has processed it, publish."""
    s = get_settings()
    uid, token = s.instagram_user_id, s.instagram_access_token.get_secret_value()
    c = _check(client.post(f"{GRAPH}/{uid}/media", data={"media_type": "REELS", "video_url": video_url, "caption": caption,
                                                         "share_to_feed": "true", "access_token": token}), "instagram")  # fmt: skip
    cid, deadline = c["id"], time.time() + wait
    while True:
        st = _check(client.get(f"{GRAPH}/{cid}", params={"fields": "status_code", "access_token": token}), "instagram")
        if st.get("status_code") == "FINISHED":
            break
        if st.get("status_code") in ("ERROR", "EXPIRED"):
            raise PublishError("Instagram could not process the video (check it is an MP4 of 3-90 s).")
        if time.time() > deadline:
            raise PublishError("Instagram is taking too long to process the video. Try again in a few minutes.")
        time.sleep(poll)
    done = _check(client.post(f"{GRAPH}/{uid}/media_publish", data={"creation_id": cid, "access_token": token}), "instagram")
    link = _check(client.get(f"{GRAPH}/{done['id']}", params={"fields": "permalink", "access_token": token}), "instagram")
    return Posted(done["id"], link.get("permalink", ""))


def post_tiktok(video_url: str, caption: str, client: httpx.Client) -> Posted:
    """TikTok Content Posting API (direct post, the video pulled from the link; the domain must be verified in the app)."""
    token = get_settings().tiktok_access_token.get_secret_value()
    r = client.post("https://open.tiktokapis.com/v2/post/publish/video/init/",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"},
                    json={"post_info": {"title": caption[:2200], "privacy_level": "PUBLIC_TO_EVERYONE"},
                          "source_info": {"source": "PULL_FROM_URL", "video_url": video_url}})  # fmt: skip
    data = _check(r, "tiktok")
    err = data.get("error") or {}
    if err.get("code") not in (None, "", "ok"):
        raise PublishError(f"TikTok said: {err.get('message') or err.get('code')}")
    return Posted(data.get("data", {}).get("publish_id", ""))


def post_youtube(path: Path, title: str, description: str, client: httpx.Client) -> Posted:
    """YouTube Data API: a fresh access token from the refresh token, then a resumable upload (vertical + <=60 s = a Short)."""
    s = get_settings()
    tok = _check(client.post("https://oauth2.googleapis.com/token", data={
        "client_id": s.youtube_client_id, "client_secret": s.youtube_client_secret.get_secret_value(),
        "refresh_token": s.youtube_refresh_token.get_secret_value(), "grant_type": "refresh_token"}), "youtube")["access_token"]  # fmt: skip
    title = title if "#shorts" in title.lower() else f"{title} #Shorts"
    start = client.post("https://www.googleapis.com/upload/youtube/v3/videos", params={"uploadType": "resumable", "part": "snippet,status"},
                        headers={"Authorization": f"Bearer {tok}", "X-Upload-Content-Type": "video/mp4"},
                        json={"snippet": {"title": title[:100], "description": description[:5000]}, "status": {"privacyStatus": "public"}})  # fmt: skip
    _check(start, "youtube")
    up = client.put(start.headers["location"], content=path.read_bytes(), headers={"Content-Type": "video/mp4"}, timeout=600)
    vid = _check(up, "youtube")["id"]
    return Posted(vid, f"https://youtube.com/shorts/{vid}")
