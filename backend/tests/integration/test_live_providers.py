"""Live provider tests: real calls to OpenAI / Gemini / Ollama. Skipped unless you opt in with LIVE_* variables
(the normal test suite never uses real keys, and never reads them from .env):

    LIVE_GEMINI_API_KEY=...  LIVE_GEMINI_MODEL=<model>   .venv\\Scripts\\python -m pytest tests/integration -m live
    LIVE_OPENAI_API_KEY=...  LIVE_OPENAI_MODEL=<model>
    LIVE_OLLAMA_MODEL=<model> (Ollama running on localhost:11434)

Each test makes one or two tiny calls (a fraction of a cent on cloud providers).
"""

from __future__ import annotations

import os

import pytest
from pydantic import BaseModel

from app.ai.types import AIProviderError

pytestmark = pytest.mark.live


class Answer(BaseModel):
    status: str
    number: int


def _providers():
    out = []
    if os.environ.get("LIVE_GEMINI_API_KEY") and os.environ.get("LIVE_GEMINI_MODEL"):
        from app.ai.gemini_provider import GeminiProvider

        out.append(pytest.param(lambda: GeminiProvider(os.environ["LIVE_GEMINI_API_KEY"], os.environ["LIVE_GEMINI_MODEL"], timeout=60), id="gemini"))
    if os.environ.get("LIVE_OPENAI_API_KEY") and os.environ.get("LIVE_OPENAI_MODEL"):
        from app.ai.openai_provider import OpenAIProvider

        out.append(pytest.param(lambda: OpenAIProvider(os.environ["LIVE_OPENAI_API_KEY"], os.environ["LIVE_OPENAI_MODEL"], timeout=60), id="openai"))
    if os.environ.get("LIVE_OLLAMA_MODEL"):
        from app.ai.ollama import OllamaProvider

        out.append(pytest.param(lambda: OllamaProvider("http://localhost:11434", os.environ["LIVE_OLLAMA_MODEL"], 300), id="ollama"))
    return out or [pytest.param(None, id="no-live-provider", marks=pytest.mark.skip(reason="set LIVE_* variables to run live tests"))]


@pytest.fixture(params=_providers())
def provider(request):
    from app.ai.managed import ManagedProvider

    return ManagedProvider(request.param(), task="test", max_retries=2)


def test_live_health(provider):
    assert provider.health()["available"] is True


def test_live_structured_output(provider):
    ans = provider.generate_structured("You check an AI connection.", "Reply with status='ok' and number=42.", Answer, task="test")
    assert ans.status.lower() == "ok" and ans.number == 42
    assert provider.last_result.latency_ms > 0


def test_live_vision(provider):
    import cv2
    import numpy as np

    img = np.zeros((64, 64, 3), np.uint8)
    img[:, :] = (40, 40, 220)
    ans = provider.generate_vision_structured("You check an AI connection.", "Reply status='ok'; number=1 if the square is red, else 0.",
                                              [cv2.imencode(".jpg", img)[1].tobytes()], Answer)  # fmt: skip
    assert ans.number == 1


def test_live_director_plan_validates(provider):
    import sys

    from app.ai.reel_director import ask_director, build_request
    from app.director.ai_plan import plan_to_timeline
    from app.director.music_map import build_music_map
    from app.styles import get_style, list_styles

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from tests.test_timeline import make_audio, make_clip

    audio = make_audio(duration=40)
    clips = [make_clip(f"id{i}", dur=6.0, sig_bin=i) for i in range(4)]
    mm = build_music_map(audio, 0.0, 12.0)
    styles = {s.id: s.description for s in list_styles() if s.id not in ("custom", "auto")}
    facts, alias = build_request(clips, audio, mm, 0.0, 12.0, styles, brief="test", language="en", style_hint=None, captions=False,
                                 cta="", hook="", pace="balanced")  # fmt: skip
    try:
        plan = ask_director(provider, facts)
    except AIProviderError as e:
        pytest.skip(f"provider unavailable right now: {e.message}")
    d = plan_to_timeline(plan, alias, clips, mm, 0.0, 12.0, get_style("cinematic"), style_ids=set(styles), keep_style=False)
    assert d.timeline.duration == 12.0 and d.timeline.segments
