"""Phase D: brand engine (logo watermark, colours, CTA) and templates (built-in, saved, AI-generated drafts)."""

from __future__ import annotations

import subprocess

import cv2
import numpy as np
import pytest
from bson import ObjectId

from app.ai.provider import AIResponseError, set_provider
from app.api.templates import BUILTIN, draft_from_llm, generate_draft, generate_draft_from_conversation
from app.captions.ass import build_ass
from app.captions.cues import Cue
from app.captions.transcriber import Word
from app.core.ffmpeg import find_binary
from tests.test_editor_api import ops, seeded
from tests.test_jobs_api import wait_job
from tests.test_script_voice import ScriptLLM

BRAND = {"name": "NAMORA", "colors": {"primary": "#E8D9B5", "secondary": "#111111", "accent": "#B08D57"}, "captionFont": "Georgia",
         "watermark": {"enabled": True, "position": "br", "opacity": 0.9, "scale": 0.2}, "cta": "Shop the collection",
         "language": "en", "captionStyle": "luxury", "style": "luxury", "pace": "calm", "musicStyle": "warm piano",
         "exportPreset": "instagram_reel"}  # fmt: skip


def png(w=200, h=200, color=(0, 0, 255), alpha=True) -> bytes:
    img = np.zeros((h, w, 4 if alpha else 3), np.uint8)
    img[:, :, 2] = color[2]
    img[:, :, 1] = color[1]
    img[:, :, 0] = color[0]
    if alpha:
        img[:, :, 3] = 255
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


# ------------------------------------------------------------------ brand CRUD + logo
async def test_brand_crud_and_validation(client):
    made = (await client.post("/api/brands", json=BRAND)).json()
    assert made["name"] == "NAMORA" and made["colors"]["primary"] == "#E8D9B5" and made["hasLogo"] is False
    assert [b["id"] for b in (await client.get("/api/brands")).json()] == [made["id"]]
    upd = (await client.patch(f"/api/brands/{made['id']}", json={**BRAND, "name": "Namora Jewels", "cta": "Follow us"})).json()
    assert upd["name"] == "Namora Jewels" and upd["cta"] == "Follow us"
    for bad in ({**BRAND, "colors": {"primary": "red"}}, {**BRAND, "name": ""}, {**BRAND, "watermark": {"opacity": 5}},
                {**BRAND, "language": "klingon"}):
        assert (await client.post("/api/brands", json=bad)).status_code == 422
    assert (await client.post("/api/brands", json={**BRAND, "style": "nope"})).json()["error"]["code"] == "UNKNOWN_STYLE"
    assert (await client.post("/api/brands", json={**BRAND, "exportPreset": "vhs"})).json()["error"]["code"] == "UNKNOWN_PRESET"
    assert (await client.delete(f"/api/brands/{made['id']}")).status_code == 204
    assert (await client.get(f"/api/brands/{made['id']}")).status_code == 404


async def test_logo_upload_is_validated_as_a_real_image(client, storage):
    bid = (await client.post("/api/brands", json=BRAND)).json()["id"]
    ok = await client.post(f"/api/brands/{bid}/logo", files={"file": ("logo.png", png(), "image/png")})
    assert ok.status_code == 200 and ok.json()["hasLogo"] and ok.json()["logoUrl"] == f"/api/brands/{bid}/logo"
    got = await client.get(f"/api/brands/{bid}/logo")
    assert got.status_code == 200 and got.headers["content-type"] == "image/png" and got.content[:4] == b"\x89PNG"
    big = await client.post(f"/api/brands/{bid}/logo", files={"file": ("big.png", png(2400, 1600), "image/png")})
    stored = cv2.imdecode(np.frombuffer(storage.read_bytes(f"brands/{bid}/logo.png"), np.uint8), cv2.IMREAD_UNCHANGED)
    assert big.status_code == 200 and max(stored.shape[:2]) <= 1200 and stored.shape[2] == 4  # resized, alpha kept
    fake = await client.post(f"/api/brands/{bid}/logo", files={"file": ("logo.png", b"MZ not an image" * 50, "image/png")})
    assert fake.status_code == 415 and fake.json()["error"]["code"] == "INVALID_IMAGE"
    assert (await client.post(f"/api/brands/{bid}/logo", files={"file": ("logo.exe", png(), "image/png")})).status_code == 415
    assert (await client.post(f"/api/brands/{bid}/logo", files={"file": ("tiny.png", png(4, 4), "image/png")})).status_code == 415
    assert (await client.post("/api/brands/507f1f77bcf86cd799439011/logo", files={"file": ("l.png", png(), "image/png")})).status_code == 404
    await client.delete(f"/api/brands/{bid}")
    assert not storage.exists(f"brands/{bid}/logo.png")  # deleting a brand removes its files


def test_brand_colour_and_font_reach_the_captions_safely():
    cue = [Cue(0, 2, (Word("hello", 0, 1), Word("world", 1, 2)))]
    ass = build_ass(cue, "minimal", color="#FF8800", font="Playfair Display")
    style = [ln for ln in ass.splitlines() if ln.startswith("Style:")][0]
    assert "&H000088FF" in style and "Playfair Display" in style  # #RRGGBB -> ASS &HBBGGRR
    evil = build_ass(cue, "minimal", font="Arial,0,0\nDialogue: 0,0:00:00.00,9:00:00.00,Default,,0,0,0,,HACKED")
    assert evil.count("Dialogue:") == 1 and "HACKED" not in [ln for ln in evil.splitlines() if ln.startswith("Style:")][0].split(",")[0]
    hl = build_ass(cue, "highlight", color="#00FF00")
    assert "&H0000FF00" in hl


# ------------------------------------------------------------------ apply a brand
async def test_applying_a_brand_restyles_settings_and_the_edit_in_one_undoable_step(client, db, media_dir, storage):
    pid, tl = await seeded(client, db, media_dir, duration=8)
    bid = (await client.post("/api/brands", json=BRAND)).json()["id"]
    await client.post(f"/api/brands/{bid}/logo", files={"file": ("logo.png", png(), "image/png")})
    before = (await client.get(f"/api/projects/{pid}/timeline")).json()

    r = await client.post(f"/api/projects/{pid}/apply-brand", json={"brandId": bid})
    assert r.status_code == 200, r.text
    body = r.json()
    t = body["state"]["timeline"]
    assert t["captionStyle"] == "luxury" and t["captionFont"] == "Georgia" and t["captionColor"] == "#E8D9B5"
    assert t["watermark"]["logoKey"] == f"brands/{bid}/logo.png" and t["watermark"]["position"] == "br" and t["watermark"]["scale"] == 0.2
    assert [c["text"] for c in t["captions"]] == ["Shop the collection"]  # the CTA end card
    assert t["captions"][0]["end"] <= t["duration"] and t["captions"][0]["start"] >= t["duration"] - 2.6
    s = body["settings"]
    assert (s["brandId"], s["captionStyle"], s["style"], s["pace"]) == (bid, "luxury", "luxury", "calm")
    assert body["state"]["history"][-1]["label"] == "Brand: NAMORA"

    again = (await client.post(f"/api/projects/{pid}/apply-brand", json={"brandId": bid})).json()["state"]["timeline"]
    assert len(again["captions"]) == 1  # applying twice does not stack CTAs
    await client.post(f"/api/projects/{pid}/timeline/undo")
    undone = (await client.post(f"/api/projects/{pid}/timeline/undo")).json()
    assert undone["timeline"]["watermark"] is None and undone["timeline"]["captions"] == before["timeline"]["captions"]

    nologo = (await client.post("/api/brands", json={**BRAND, "name": "No Logo"})).json()["id"]
    r2 = (await client.post(f"/api/projects/{pid}/apply-brand", json={"brandId": nologo})).json()
    assert r2["state"]["timeline"]["watermark"] is None  # no logo file => no watermark
    only_settings = (await client.post(f"/api/projects/{pid}/apply-brand", json={"brandId": bid, "toTimeline": False})).json()
    assert only_settings["state"] is None and only_settings["settings"]["brandId"] == bid
    assert (await client.post(f"/api/projects/{pid}/apply-brand", json={"brandId": "507f1f77bcf86cd799439011"})).status_code == 404


@pytest.mark.slow
async def test_the_logo_is_burned_into_the_rendered_video_in_the_right_corner(client, db, media_dir, storage):
    """Render the same edit without and with the brand: only the bottom-right corner may change."""
    pid, _ = await seeded(client, db, media_dir, duration=6)

    async def frame():
        job = (await client.post(f"/api/projects/{pid}/render", json={"quality": "preview"})).json()
        done, _ = await wait_job(client, pid, job["id"])
        assert done["status"] == "completed", done["error"]
        prev = (await client.get(f"/api/projects/{pid}/preview")).json()
        path = storage.local_path(f"projects/{pid}/output/preview_{prev['id']}.mp4")
        raw = subprocess.run([find_binary("ffmpeg"), "-v", "error", "-ss", "1.5", "-i", str(path), "-frames:v", "1", "-f", "rawvideo",
                              "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout  # fmt: skip
        return np.frombuffer(raw, np.uint8).reshape(prev["height"], prev["width"], 3).astype(int)

    plain = await frame()
    bid = (await client.post("/api/brands", json={**BRAND, "cta": "", "watermark": {**BRAND["watermark"], "opacity": 1.0}})).json()["id"]
    await client.post(f"/api/brands/{bid}/logo", files={"file": ("logo.png", png(color=(0, 255, 0)), "image/png")})  # pure green (BGR)
    await client.post(f"/api/projects/{pid}/apply-brand", json={"brandId": bid})
    branded = await frame()
    h, w = plain.shape[:2]
    diff = np.abs(plain - branded).sum(axis=2)
    corner = diff[int(h * 0.70) : int(h * 0.84), int(w * 0.72) : int(w * 0.96)]
    rest = diff.copy()
    rest[int(h * 0.68) : int(h * 0.86), int(w * 0.70) : int(w * 0.98)] = 0
    assert (corner > 60).mean() > 0.5, "the logo appears in the bottom-right corner"
    assert (rest > 60).mean() < 0.02, "and the rest of the picture is untouched"
    logo_px = branded[int(h * 0.72) : int(h * 0.80), int(w * 0.76) : int(w * 0.92)]
    assert (logo_px[..., 1] > 200).mean() > 0.4 and (logo_px[..., 0] < 60).mean() > 0.4  # it is the (green) logo colour


# ------------------------------------------------------------------ templates
async def test_builtin_and_saved_templates(client):
    listing = (await client.get("/api/templates")).json()
    ids = {t["id"] for t in listing}
    assert {"food_fast_reel", "luxury_product", "travel_story", "voiceover_explainer", "clean_minimal"} <= ids
    assert all(t["builtin"] for t in listing) and len(listing) == len(BUILTIN)
    assert (await client.patch("/api/templates/food_fast_reel", json={"name": "x"})).json()["error"]["code"] == "TEMPLATE_READ_ONLY"
    assert (await client.delete("/api/templates/food_fast_reel")).status_code == 409

    mine = (await client.post("/api/templates", json={"name": "My Reel", "duration": 20, "style": "cinematic", "captions": True,
                                                       "captionStyle": "karaoke"})).json()  # fmt: skip
    assert mine["builtin"] is False and mine["duration"] == 20
    upd = (await client.patch(f"/api/templates/{mine['id']}", json={"name": "My Reel v2", "duration": 25, "style": "travel"})).json()
    assert upd["name"] == "My Reel v2" and upd["style"] == "travel"
    for bad in ({"name": "x", "duration": 601}, {"name": "x", "style": "nope"}, {"name": "x", "exportPreset": "vhs"}):
        assert (await client.post("/api/templates", json=bad)).status_code == 422
    fav = (await client.put(f"/api/templates/{mine['id']}/favorite", json={"favorite": True})).json()
    assert fav["favorite"] is True
    assert next(t for t in (await client.get("/api/templates")).json() if t["id"] == mine["id"])["favorite"] is True
    assert (await client.delete(f"/api/templates/{mine['id']}")).status_code == 204
    assert mine["id"] not in {t["id"] for t in (await client.get("/api/templates")).json()}


async def test_applying_a_template_sets_the_project_and_counts_usage(client, db, media_dir):
    pid, _ = await seeded(client, db, media_dir)
    r = (await client.post(f"/api/projects/{pid}/apply-template", json={"templateId": "food_fast_reel"})).json()
    s = r["settings"]
    assert (s["duration"], s["style"], s["captions"], s["captionStyle"]) == (15, "food", True, "bold") and r["hook"] is True
    await client.post(f"/api/projects/{pid}/apply-template", json={"templateId": "luxury_product"})
    await client.post(f"/api/projects/{pid}/apply-template", json={"templateId": "luxury_product"})
    used = {t["id"]: t["uses"] for t in (await client.get("/api/templates")).json()}
    assert used["luxury_product"] == 2 and used["food_fast_reel"] == 1
    mine = (await client.post("/api/templates", json={"name": "Mine", "duration": 45, "style": "cinematic"})).json()
    assert (await client.post(f"/api/projects/{pid}/apply-template", json={"templateId": mine["id"]})).json()["settings"]["duration"] == 45
    assert (await client.post(f"/api/projects/{pid}/apply-template", json={"templateId": "507f1f77bcf86cd799439011"})).status_code == 404


def test_ai_template_drafts_are_coerced_to_valid_values():
    d = draft_from_llm({"name": "  Luxury\njewellery reel ", "duration": "45.7", "style": "sparkle", "pace": "warp", "captions": 1,
                        "captionStyle": "comic", "audioMode": "voice_music", "language": "mr", "exportPreset": "vhs",
                        "description": "x" * 500})  # fmt: skip
    assert d.name == "Luxury jewellery reel" and d.duration == 45 and d.style == "fast_trending" and d.pace == "balanced"
    assert d.caption_style == "minimal" and d.audio_mode == "voice_music" and d.language == "mr" and d.export_preset == "instagram_reel"
    assert len(d.description) <= 300 and d.captions is True
    assert draft_from_llm({"name": "x", "duration": 99999}).duration == 600 and draft_from_llm({"name": "x", "duration": -3}).duration == 5
    assert draft_from_llm({"name": "x", "style": "auto"}).style == "auto"
    assert draft_from_llm({"name": "   "}).name == "AI template"  # a blank name falls back instead of failing
    assert draft_from_llm({}).duration == 15


async def test_ai_template_generator_returns_a_draft_and_saves_nothing(client):
    set_provider(ScriptLLM({"name": "Luxury Jewellery Reel", "description": "Slow reveal.", "duration": 15, "style": "luxury", "pace": "calm",
                            "captions": False, "captionStyle": "luxury", "audioMode": "music", "exportPreset": "instagram_reel"}))  # fmt: skip
    try:
        r = (await client.post("/api/templates/generate", json={"prompt": "Create a template for luxury jewellery reels."})).json()
        assert r["draft"] is True and r["template"]["name"] == "Luxury Jewellery Reel" and r["template"]["style"] == "luxury"
        assert len((await client.get("/api/templates")).json()) == len(BUILTIN)  # not saved until the user says so
        saved = (await client.post("/api/templates", json=r["template"])).status_code
        assert saved == 201 and len((await client.get("/api/templates")).json()) == len(BUILTIN) + 1
        prompt_sent = set_provider  # noqa: F841
    finally:
        set_provider(None)
    assert generate_draft(ScriptLLM({"name": "Food", "style": "food"}), "food").style == "food"
    assert (await client.post("/api/templates/generate", json={"prompt": "x"})).status_code == 422


async def test_a_template_can_be_drafted_from_a_chat_conversation_and_saved(client):
    set_provider(ScriptLLM({"name": "Calm Luxury Reel", "description": "Slow shots, no captions.", "duration": 20,
                            "style": "luxury", "pace": "calm", "captions": False, "audioMode": "music"}))  # fmt: skip
    try:
        transcript = (
            "user: I want my Reels calmer, with longer shots and no captions\n"
            "assistant: Got it — luxury style with a calm pace and captions off usually reads that way.\n"
            "user: yes exactly that"
        )
        r = await client.post("/api/templates/generate-from-chat", json={"transcript": transcript})
        assert r.status_code == 200
        j = r.json()
        assert j["draft"] is True and j["template"]["name"] == "Calm Luxury Reel" and j["template"]["pace"] == "calm"
        assert len((await client.get("/api/templates")).json()) == len(BUILTIN)  # not saved until the user says so

        saved = await client.post("/api/templates", json=j["template"])
        assert saved.status_code == 201
        assert len((await client.get("/api/templates")).json()) == len(BUILTIN) + 1
    finally:
        set_provider(None)
    assert generate_draft_from_conversation(ScriptLLM({"name": "Food", "style": "food"}), "user: food reels please").style == "food"


async def test_generate_from_chat_needs_a_real_transcript(client):
    set_provider(ScriptLLM({"name": "x"}))
    try:
        assert (await client.post("/api/templates/generate-from-chat", json={"transcript": "hi"})).status_code == 422
        assert (await client.post("/api/templates/generate-from-chat", json={"transcript": ""})).status_code == 422
    finally:
        set_provider(None)
