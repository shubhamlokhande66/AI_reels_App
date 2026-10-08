"""Story -> Reel: planning, pictures (library / upload), the camera, captions, and a full narrated render."""

from __future__ import annotations

import asyncio
import wave
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.story import images as im
from app.story.models import StoryPlan, StoryScene
from app.story.planner import from_ai, simple_plan
from app.story.render import _chunks, camera

STORY = ("Arjuna stood in his chariot at Kurukshetra. He saw his teachers and cousins in the enemy army. His bow slipped from his hand. "
         "Krishna smiled and spoke of duty. Do your work and do not worry about the fruit. Arjuna lifted his bow again.")  # fmt: skip


def test_ai_plan_is_validated_and_limited():
    data = {"title": "The Gita", "characters": [{"name": "Krishna", "look": "blue skin, peacock feather"}, {"name": ""}],
            "scenes": [{"narration": "अर्जुन रुक गया।", "visual": "Arjuna on a chariot", "characters": ["Krishna", "Nobody"], "shot": "huge",
                        "mood": "angry", "keywords": ["Arjuna", "chariot"]},
                       {"narration": "", "visual": "dropped"},
                       {"narration": "कृष्ण बोले।", "visual": "Krishna speaks", "mood": "devotional"}],
            "post": {"title": "Gita", "hashtags": ["gita", "#krishna"]}}  # fmt: skip
    plan = from_ai(data, "hi", "ravi_varma", "fallback")
    assert [c.name for c in plan.characters] == ["Krishna"]
    assert len(plan.scenes) == 2 and plan.scenes[0].shot == "medium" and plan.scenes[0].mood == "calm"
    assert plan.scenes[0].characters == ["Krishna"]  # unknown names dropped
    assert plan.post_copy["hashtags"] == ["#gita", "#krishna"]


def test_without_ai_the_story_is_split_by_sentence():
    plan = simple_plan(STORY, "en", "watercolor", 3, "Gita")
    assert len(plan.scenes) == 3 and all(s.narration for s in plan.scenes)


def test_prompt_keeps_every_character_looking_the_same():
    plan = from_ai({"characters": [{"name": "Krishna", "look": "blue skin, peacock feather"}],
                    "scenes": [{"narration": "a", "visual": "Krishna on the chariot", "characters": ["Krishna"]},
                               {"narration": "b", "visual": "The army waits"}]}, "hi", "ravi_varma", "t")  # fmt: skip
    p = im.prompt_for(plan, plan.scenes[0])
    assert "Raja Ravi Varma" in p and "peacock feather" in p and "No text" in p
    assert "peacock" not in im.prompt_for(plan, plan.scenes[1])


@pytest.mark.parametrize("size", [(1920, 1200), (1080, 1920), (1000, 1000), (600, 1600)])
def test_camera_never_leaves_the_picture(size):
    iw, ih = size
    s = StoryScene(id="x", narration="n", visual="v", shot="close")
    for i in range(4):
        cam = camera(i, s, iw, ih, 0.12)
        for v in (cam.start, cam.end):
            half_w = (v.hh * ih * 9 / 16) / (2 * iw)
            assert v.cx - half_w >= -1e-6 and v.cx + half_w <= 1 + 1e-6, (size, i, v)
            assert v.hh <= 1 + 1e-6 or half_w <= 0.5 + 1e-6


def test_captions_fit_a_phone_screen():
    lines = _chunks("कुरुक्षेत्र के मैदान में, अर्जुन का मन डगमगा गया और धनुष हाथ से छूट गया।")
    assert len(lines) >= 3 and all(len(x) <= 22 for x in lines)


def test_indic_text_is_shaped_without_letter_spacing(tmp_path):
    from app.product.models import TextLayer
    from app.product.textass import write_text_ass
    from app.story.render import STORY_STYLE

    hi = write_text_ass([TextLayer(id="a", text="अर्जुन", start=0, end=1)], STORY_STYLE, tmp_path / "hi.ass", 1080, 1920).read_text("utf-8")
    en = write_text_ass([TextLayer(id="a", text="Arjuna", start=0, end=1)], STORY_STYLE, tmp_path / "en.ass", 1080, 1920).read_text("utf-8")
    assert ",100,100,0,0,1," in hi and ",100,100,1.5,0,1," in en


def _png(path: Path, color: tuple[int, int, int], size=(1600, 1000)) -> bytes:
    img = np.zeros((size[1], size[0], 3), np.uint8)
    img[:] = color
    cv2.circle(img, (size[0] // 2, size[1] // 2), size[1] // 4, (255, 255, 255), -1)
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes()


class FakeVoice:
    """Writes a short tone per line, so the timing and mixing are real without any speech engine."""

    def find_voice(self, language, preferred=None):
        from app.voice.base import VoiceInfo

        return VoiceInfo(id="fake", name="Fake", language=language)

    def synthesize(self, ssml, voice_id, out: Path):
        sr = 24000
        t = np.arange(int(sr * 1.2)) / sr
        data = (np.sin(2 * np.pi * 220 * t) * 0.3 * 32767).astype(np.int16)
        out.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(data.tobytes())


async def test_story_api_plan_pictures_and_errors(client):
    r = await client.post("/api/story", json={"text": STORY, "language": "en", "artStyle": "watercolor", "scenes": 3})
    assert r.status_code == 201, r.text
    story = r.json()
    pid, scenes = story["projectId"], story["scenes"]
    assert len(scenes) == 3 and all(s["imageUrl"] is None for s in scenes)
    assert (await client.get(f"/api/projects/{pid}")).json()["settings"]["reelType"] == "story"

    # no picture source connected for this style: a clear message, not a crash
    r = await client.post(f"/api/projects/{pid}/story/scenes/{scenes[0]['id']}/picture", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "NO_PICTURE"
    # rendering needs every picture
    r = await client.post(f"/api/projects/{pid}/story/render", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "STORY_PICTURES_MISSING"
    bad = await client.post(f"/api/projects/{pid}/story/scenes/{scenes[0]['id']}/upload", files={"file": ("x.jpg", b"not an image", "image/jpeg")})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_IMAGE"

    # edit: reorder, change a line, delete a scene
    edit = [{"id": scenes[2]["id"], "narration": "The end first.", "visual": scenes[2]["visual"]},
            {"id": scenes[0]["id"], "narration": scenes[0]["narration"], "visual": scenes[0]["visual"]}]  # fmt: skip
    r = await client.put(f"/api/projects/{pid}/story", json={"title": "Gita", "scenes": edit})
    assert [s["narration"] for s in r.json()["scenes"]][0] == "The end first." and r.json()["title"] == "Gita"


@pytest.mark.slow
async def test_a_story_is_narrated_and_rendered(client, tmp_path):
    from tests.test_jobs_api import wait_job

    from app.voice.sapi import set_voice_provider

    set_voice_provider(FakeVoice())
    try:
        story = (await client.post("/api/story", json={"text": STORY, "language": "hi", "artStyle": "watercolor", "scenes": 3})).json()
        pid = story["projectId"]
        for s, c in zip(story["scenes"], [(40, 60, 160), (160, 60, 40), (60, 140, 60)]):
            r = await client.post(f"/api/projects/{pid}/story/scenes/{s['id']}/upload", files={"file": ("p.png", _png(tmp_path, c), "image/png")})
            assert r.status_code == 200, r.text
        story = (await client.get(f"/api/projects/{pid}/story")).json()
        assert all(s["source"] == "upload" and s["imageUrl"] for s in story["scenes"])
        img = await client.get(story["scenes"][0]["imageUrl"])
        assert img.status_code == 200 and img.headers["content-type"] == "image/png"
        job = (await client.post(f"/api/projects/{pid}/story/render", json={"quality": "preview"})).json()
        assert job["type"] == "story"
        done, _ = await wait_job(client, pid, job["id"], timeout=600)
        assert done["status"] == "completed", done["error"]
        p = (await client.get(f"/api/projects/{pid}")).json()
        assert p["preview"] is not None and p["preview"]["duration"] >= 3 * 3.0 - 0.5  # three scenes, at least 3 s each (a preview render)
    finally:
        set_voice_provider(None)


async def test_shared_library_reuses_pictures(db, storage):
    from app.story.service import SharedLibrary

    loop = asyncio.get_running_loop()
    lib = SharedLibrary(loop)
    scene = StoryScene(id="s", narration="n", visual="Krishna on the chariot", keywords=["Krishna", "chariot"], characters=["Krishna"])
    key = im.library_key("ravi_varma", scene)
    pic = im.Picture(b"\x89PNG\r\n\x1a\n" + b"0" * 50, "png", "free_ai", "AI picture")
    await asyncio.to_thread(lib.remember, key, "ravi_varma", scene, pic)
    same = await asyncio.to_thread(lib.get, key, "ravi_varma", scene, set())
    assert same is not None and same.source == "library" and same.data == pic.data
    similar = StoryScene(id="t", narration="n", visual="Krishna drives the chariot", keywords=["Krishna", "chariot"], characters=["Krishna"])
    hit = await asyncio.to_thread(lib.get, im.library_key("ravi_varma", similar), "ravi_varma", similar, set())
    assert hit is not None  # same people and things: reused
    assert await asyncio.to_thread(lib.get, key, "ravi_varma", scene, {key}) is None  # "Another picture" skips it
    assert await asyncio.to_thread(lib.get, key, "anime", scene, set()) is not None  # the exact description is the key
    other = StoryScene(id="u", narration="n", visual="Draupadi in the court", keywords=["Draupadi", "court"])
    assert await asyncio.to_thread(lib.get, im.library_key("ravi_varma", other), "ravi_varma", other, set()) is None


def test_plan_survives_a_round_trip():
    plan = simple_plan(STORY, "hi", "ravi_varma", 4, "t")
    assert StoryPlan.model_validate(plan.model_dump(mode="json")).scenes[0].id == plan.scenes[0].id


def _commons(pages_by_query):
    """A fake Wikimedia API: search results by query, and a tiny JPEG for every file."""
    import httpx

    def handler(req):
        if req.url.host == "upload.example":
            return httpx.Response(200, content=b"\xff\xd8\xff\xe0jpeg")
        q = req.url.params.get("gsrsearch", "").replace(" filetype:bitmap", "")
        pages = {}
        for i, title in enumerate(pages_by_query.get(q, [])):
            pages[str(i)] = {"title": title, "index": i, "imageinfo": [{"width": 1600, "height": 1000, "thumburl": "https://upload.example/x.jpg",
                             "extmetadata": {"LicenseShortName": {"value": "Public domain"}, "Artist": {"value": "Raja Ravi Varma"}}}]}  # fmt: skip
        return httpx.Response(200, json={"query": {"pages": pages}})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_painting_search_falls_back_to_each_name_and_the_storys_people():
    scene = StoryScene(id="s", narration="n", visual="v", keywords=["Chakravyuh", "Kurukshetra war", "golden maze"], characters=["Abhimanyu"])
    client = _commons({'"Ravi Varma" Abhimanyu': ["File:The Death of Abhimanyu.jpg"]})
    pic = im.commons_search(scene, set(), client)
    assert pic is not None and pic.ref == "File:The Death of Abhimanyu.jpg"  # the combined search found nothing; the name alone did
    ending = StoryScene(id="e", narration="n", visual="v", keywords=["eternal glory", "dharma"])
    assert im.commons_search(ending, set(), client) is None
    assert im.commons_search(ending, set(), client, story_names=["Abhimanyu"]).ref == "File:The Death of Abhimanyu.jpg"


def test_painting_search_prefers_one_not_used_by_another_scene():
    scene = StoryScene(id="s", narration="n", visual="v", keywords=["Arjuna"], characters=["Arjuna"])
    client = _commons({'"Ravi Varma" Arjuna': ["File:Arjuna on the chariot.jpg", "File:Arjuna and Subhadra.jpg"]})
    assert im.commons_search(scene, set(), client).ref == "File:Arjuna on the chariot.jpg"
    assert im.commons_search(scene, set(), client, prefer_not={"File:Arjuna on the chariot.jpg"}).ref == "File:Arjuna and Subhadra.jpg"
    assert "chakravyuha" in im._forms("Chakravyuh") and "arjun" in im._forms("Arjuna")


def _speech(segments: list[float], pause: float, inner: float = 0.08) -> np.ndarray:
    """Fake speech: each scene is "words" (tone bursts with short gaps), scenes separated by ``pause`` of silence."""
    from app.story.render import SR

    parts = []
    for k, seconds in enumerate(segments):
        t = np.arange(int(SR * 0.3)) / SR
        word = (0.3 * np.sin(2 * np.pi * 180 * t)).astype(np.float32)
        gap = np.zeros(int(SR * inner), np.float32)
        n = max(int(seconds / 0.38), 1)
        parts += [np.concatenate([word, gap])] * n
        if k < len(segments) - 1:
            parts.append(np.zeros(int(SR * pause), np.float32))
    return np.concatenate(parts)


def test_one_recording_is_cut_into_scenes_at_the_pauses():
    from app.story.render import SR, split_narration

    texts = ["a" * 40, "b" * 80, "c" * 40]
    audio = _speech([3.0, 6.0, 3.0], pause=0.7)
    pieces = split_narration(audio, texts)
    assert len(pieces) == 3
    lengths = [len(p) / SR for p in pieces]
    assert abs(lengths[0] - 3.0) < 0.6 and abs(lengths[1] - 6.0) < 0.8 and abs(lengths[2] - 3.0) < 0.6, lengths
    assert split_narration(audio, ["only one"])[0] is audio


def test_ai_voice_reads_the_whole_story_in_one_request(tmp_path, monkeypatch):
    from app.story import render as rd
    from app.voice.base import VoiceInfo

    calls = []

    class OneShot:
        def find_voice(self, language, preferred=None):
            return VoiceInfo(id="gemini:Orus", name="Orus", language="multi")

        def synthesize(self, ssml, voice_id, out):
            import soundfile as sf

            calls.append(ssml)
            sf.write(str(out), _speech([2.0, 2.0, 2.0], pause=0.7), rd.SR)

    monkeypatch.setattr("app.voice.sapi.get_voice_provider", lambda: OneShot())
    plan = simple_plan(STORY, "en", "watercolor", 3, "Gita")
    voices, warnings = rd.speak(plan, "gemini:Orus", tmp_path, lambda f: None)
    assert len(calls) == 1 and len(voices) == 3 and all(v is not None and len(v) > rd.SR for v in voices) and not warnings


def test_daily_voice_limit_stops_with_a_clear_message(tmp_path, monkeypatch):
    from app.story import render as rd
    from app.voice.base import VoiceInfo
    from app.voice.gemini import VoiceQuotaExhausted

    class Exhausted:
        def find_voice(self, language, preferred=None):
            return VoiceInfo(id="gemini:Orus", name="Orus", language="multi")

        def synthesize(self, ssml, voice_id, out):
            raise VoiceQuotaExhausted("Today's free AI voice limit is used up.")

    monkeypatch.setattr("app.voice.sapi.get_voice_provider", lambda: Exhausted())
    with pytest.raises(VoiceQuotaExhausted):
        rd.speak(simple_plan(STORY, "en", "watercolor", 3, "Gita"), "gemini:Orus", tmp_path, lambda f: None)


def test_no_narration_needs_no_voice(tmp_path):
    from app.story import render as rd

    voices, warnings = rd.speak(simple_plan(STORY, "en", "watercolor", 3, "Gita"), "none", tmp_path, lambda f: None)
    assert voices == [None, None, None] and warnings == []
