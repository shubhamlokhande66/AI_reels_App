from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

from app.core import ratelimit
from app.core.config import get_settings
from app.core.database import set_database
from app.core.ffmpeg import find_binary
from app.storage import LocalStorage, set_storage


def _ffmpeg(*args: str) -> None:
    subprocess.run(
        [find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", *args],
        check=True, capture_output=True,
    )  # fmt: skip


def make_click_track(path: Path, bpm: float = 120.0, seconds: float = 30.0, sr: int = 22050) -> None:
    """Kick-like clicks on every beat, louder on bar downbeats, with a louder second half."""
    n = int(seconds * sr)
    y = np.zeros(n, dtype=np.float32)
    period = 60.0 / bpm
    t = np.arange(int(0.08 * sr)) / sr
    click = np.sin(2 * np.pi * 90 * t) * np.exp(-t * 45)
    k = 0
    while (start := int(k * period * sr)) < n - len(click):
        gain = 1.0 if k % 4 == 0 else 0.7
        if start / sr > seconds / 2:
            gain *= 1.4
        y[start : start + len(click)] += (gain * click).astype(np.float32)
        k += 1
    y += 0.01 * np.random.default_rng(0).standard_normal(n).astype(np.float32)
    y = np.clip(y / max(1.0, np.abs(y).max()), -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((y * 32767).astype(np.int16).tobytes())


@pytest.fixture(scope="session")
def media_dir(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("media")
    specs = {
        "clip_a.mp4": "testsrc2=size=1280x720:rate=30:duration=7",
        "clip_b.mp4": "testsrc=size=1280x720:rate=30:duration=7",
        "clip_c.mp4": "mandelbrot=size=1280x720:rate=30:end_scale=0.05",
        "clip_d.mp4": "cellauto=size=1280x720:rate=30:pattern=@:rule=110:scroll=1",
        "clip_portrait.mp4": "testsrc2=size=720x1280:rate=30:duration=7",
    }
    for name, src in specs.items():
        args = ["-f", "lavfi", "-i", src, "-t", "7"]
        _ffmpeg(*args, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(d / name))
    make_click_track(d / "beat120.wav")
    _ffmpeg("-i", str(d / "beat120.wav"), "-c:a", "libmp3lame", "-b:a", "128k", str(d / "beat120.mp3"))
    (d / "notvideo.mp4").write_bytes(b"this is not a video" * 100)
    return d


@pytest.fixture
def storage(tmp_path):
    st = LocalStorage(tmp_path / "storage")
    set_storage(st)
    yield st
    set_storage(None)


@pytest_asyncio.fixture
async def db():
    client = AsyncMongoMockClient()
    database = client["test_db"]
    set_database(database)
    yield database
    set_database(None)


@pytest_asyncio.fixture
async def client(storage, db):
    from app.main import create_app

    ratelimit.reset()
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path):
    """No test may read or write the developer's real storage folder (e.g. their saved AI model choice)."""
    set_storage(LocalStorage(tmp_path / "auto_storage"))
    yield
    set_storage(None)


@pytest.fixture(autouse=True)
def _settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _no_cloud_ai(monkeypatch):
    """Tests never use real API keys, fallbacks or budgets from the developer's .env, and never write the AI usage log
    to a real database (environment variables win over the .env file)."""
    from app.ai.usage import MemoryUsageStore, set_usage_store

    for name in ("OPENAI_API_KEY", "GEMINI_API_KEY", "AI_TEXT_PROVIDER", "AI_VISION_PROVIDER", "AI_FALLBACK_PROVIDER", "AI_MODEL_PRICES",
                 "SONG_IMPORT_FOLDERS"):
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("AI_FALLBACK_ENABLED", "false")
    monkeypatch.setenv("AI_PROVIDER", "ollama")  # the default; tests that need another provider set it themselves
    monkeypatch.setenv("AI_CURRENCY", "USD")
    monkeypatch.setenv("AI_CURRENCY_RATE", "1")
    monkeypatch.setenv("DAILY_AI_BUDGET", "0")
    monkeypatch.setenv("MONTHLY_AI_BUDGET", "0")
    store = MemoryUsageStore()
    set_usage_store(store)
    yield store
    set_usage_store(None)
