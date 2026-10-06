"""Provider contract tests: Ollama, OpenAI, Gemini and Claude must behave the same behind ``AIProvider``.

Everything is mocked (Ollama through ``httpx.post``, OpenAI and Gemini through fake SDK clients); no API key or
network is needed. Plus: the managed provider (retry, fallback, budget, usage log), routing and key safety.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import anthropic
import httpx
import httpx2
import openai
import pytest
from google.genai import errors as gerrors
from pydantic import BaseModel

from app.ai.claude_provider import ClaudeProvider
from app.ai.gemini_provider import GeminiProvider
from app.ai.managed import ManagedProvider
from app.ai.ollama import OllamaProvider
from app.ai.openai_provider import OpenAIProvider
from app.ai.provider import AIProvider, AIResponseError
from app.ai.types import AIProviderError, AIRequest, AIResult


class Answer(BaseModel):
    status: str
    number: int


REQ = httpx.Request("POST", "https://api.example/v1/x")


# ---------------------------------------------------------------------- per-provider harnesses
class OpenAIFake:
    def __init__(self):
        self.replies: list = []
        self.calls: list[dict] = []
        self.responses = SimpleNamespace(create=self._create)
        self.models = SimpleNamespace(list=lambda: [SimpleNamespace(id="m-b"), SimpleNamespace(id="m-a")],
                                      retrieve=lambda model, timeout=None: SimpleNamespace(id=model))  # fmt: skip

    def _create(self, **kw):
        self.calls.append(kw)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        usage = SimpleNamespace(input_tokens=11, output_tokens=5, input_tokens_details=SimpleNamespace(cached_tokens=2))
        return SimpleNamespace(output_text=r, output=[], status="completed", usage=usage, model=kw["model"], id="resp_1")


def _oa_status(cls, status, code=None):
    return cls("boom", response=httpx.Response(status, request=REQ), body={"code": code} if code else None)


OPENAI_ERRORS = {
    "timeout": lambda: openai.APITimeoutError(request=REQ),
    "rate_limit": lambda: _oa_status(openai.RateLimitError, 429),
    "quota": lambda: _oa_status(openai.RateLimitError, 429, "insufficient_quota"),
    "auth": lambda: _oa_status(openai.AuthenticationError, 401),
    "temporary": lambda: _oa_status(openai.InternalServerError, 500),
    "bad_request": lambda: _oa_status(openai.BadRequestError, 400),
    "unavailable": lambda: openai.APIConnectionError(request=REQ),
}


class GeminiFake:
    def __init__(self):
        self.replies: list = []
        self.calls: list[dict] = []
        self.models = SimpleNamespace(generate_content=self._gen, list=lambda: [SimpleNamespace(name="models/g-1", supported_actions=["generateContent"]),
                                                                               SimpleNamespace(name="models/embed", supported_actions=["embedContent"])],
                                      get=lambda model: SimpleNamespace(name=model))  # fmt: skip

    def _gen(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        um = SimpleNamespace(prompt_token_count=9, candidates_token_count=4, thoughts_token_count=None, cached_content_token_count=None)
        return SimpleNamespace(text=r, candidates=[SimpleNamespace(finish_reason="STOP")], prompt_feedback=None, usage_metadata=um,
                               response_id="g_1", model_version=model)  # fmt: skip


def _g(code, status, msg="boom"):
    return (gerrors.ServerError if code >= 500 else gerrors.ClientError)(code, {"error": {"code": code, "message": msg, "status": status}})


def _g429(quota_id, delay):
    """A 429 exactly as Gemini sends it: the text always says quota + billing; the details say per-minute or per-day."""
    details = [{"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{"quotaId": quota_id}]}]
    if delay:
        details.append({"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay})
    return gerrors.ClientError(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "details": details,
                                               "message": "You exceeded your current quota, please check your plan and billing details."}})


GEMINI_ERRORS = {
    "timeout": lambda: httpx.ReadTimeout("slow"),
    "rate_limit": lambda: _g429("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "37s"),
    "quota": lambda: _g429("GenerateRequestsPerDayPerProjectPerModel-FreeTier", None),
    "auth": lambda: _g(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."),
    "temporary": lambda: _g(503, "UNAVAILABLE"),
    "bad_request": lambda: _g(400, "INVALID_ARGUMENT", "bad field"),
    "unavailable": lambda: httpx.ConnectError("refused"),
}

class ClaudeFake:
    def __init__(self):
        self.replies: list = []
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))
        self.models = SimpleNamespace(list=lambda: [SimpleNamespace(id="claude-b"), SimpleNamespace(id="claude-a")],
                                      retrieve=lambda model: SimpleNamespace(id=model))  # fmt: skip

    def _create(self, **kw):
        self.calls.append(kw)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        if isinstance(r, SimpleNamespace):
            return r
        usage = SimpleNamespace(input_tokens=10, output_tokens=6, cache_read_input_tokens=0)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=r)], stop_reason="end_turn", stop_details=None,
                               usage=usage, model=kw["model"], id="msg_1", _request_id="req_1")  # fmt: skip


CREQ = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _c(cls, status, msg="boom", headers=None):
    return cls(msg, response=httpx2.Response(status, request=CREQ, headers=headers or {}), body=None)


CLAUDE_ERRORS = {
    "timeout": lambda: anthropic.APITimeoutError(request=CREQ),
    "rate_limit": lambda: _c(anthropic.RateLimitError, 429, headers={"retry-after": "12"}),
    "quota": lambda: _c(anthropic.BadRequestError, 400, "Your credit balance is too low to access the Anthropic API."),
    "auth": lambda: _c(anthropic.AuthenticationError, 401),
    "temporary": lambda: _c(anthropic.InternalServerError, 529, "Overloaded"),
    "bad_request": lambda: _c(anthropic.BadRequestError, 400, "messages: field required"),
    "unavailable": lambda: anthropic.APIConnectionError(request=CREQ),
    "model_missing": lambda: _c(anthropic.NotFoundError, 404),
}

OLLAMA_ERRORS = {
    "timeout": lambda: httpx.ReadTimeout("slow"),
    "temporary": lambda: httpx.Response(500, text="oops"),
    "bad_request": lambda: httpx.Response(400, text="bad"),
    "unavailable": lambda: httpx.ConnectError("refused"),
    "model_missing": lambda: httpx.Response(404, text="no model"),
}


class Harness:
    """Makes a provider whose next answers are ``replies`` (text or an error)."""

    def __init__(self, name, monkeypatch):
        self.name = name
        self.monkeypatch = monkeypatch
        self.calls: list = []

    def make(self, *replies) -> AIProvider:
        if self.name == "openai":
            fake = OpenAIFake()
            fake.replies = [OPENAI_ERRORS[r[1:]]() if isinstance(r, str) and r.startswith("!") else r for r in replies]
            self.calls = fake.calls
            return OpenAIProvider(model="text-m", vision_model="vision-m", client=fake)
        if self.name == "gemini":
            fake = GeminiFake()
            fake.replies = [GEMINI_ERRORS[r[1:]]() if isinstance(r, str) and r.startswith("!") else r for r in replies]
            self.calls = fake.calls
            return GeminiProvider(model="text-m", vision_model="vision-m", client=fake)
        if self.name == "claude":
            fake = ClaudeFake()
            fake.replies = [CLAUDE_ERRORS[r[1:]]() if isinstance(r, str) and r.startswith("!") else r for r in replies]
            self.calls = fake.calls
            return ClaudeProvider(model="text-m", vision_model="vision-m", client=fake)
        queue = list(replies)
        calls = self.calls

        def post(url, json=None, timeout=None):
            calls.append(json)
            r = queue.pop(0)
            if isinstance(r, str) and r.startswith("!"):
                err = OLLAMA_ERRORS[r[1:]]()
                if isinstance(err, Exception):
                    raise err
                return err
            return httpx.Response(200, json={"message": {"content": r}, "prompt_eval_count": 7, "eval_count": 3})

        self.monkeypatch.setattr(httpx, "post", post)
        return OllamaProvider("http://ollama:11434", "text-m", 30, vision_model="vision-m")

    def last_model(self) -> str:
        c = self.calls[-1]
        return c["model"]


@pytest.fixture(params=["ollama", "openai", "gemini", "claude"])
def h(request, monkeypatch):
    return Harness(request.param, monkeypatch)


# ---------------------------------------------------------------------- the contract
def test_chat_returns_text_and_normalized_result(h):
    p = h.make("hello there")
    assert p.chat("sys", "hi") == "hello there"
    res = h.make("again").generate(AIRequest(system="s", user="u", task="chat"))
    assert isinstance(res, AIResult) and res.text == "again" and res.provider == h.name and res.model == "text-m"
    assert res.input_tokens and res.output_tokens and res.latency_ms >= 0 and res.task == "chat"


def test_chat_json(h):
    assert h.make('{"a": 1}').chat_json("sys", "give json") == {"a": 1}
    with pytest.raises(AIResponseError):
        h.make("not json at all").chat_json("sys", "give json")


def test_chat_images_uses_the_vision_model(h):
    p = h.make('{"scene": "beach"}')
    assert p.chat_images("sys", "look", ["QUJD"]) == {"scene": "beach"}
    assert h.last_model() == "vision-m"


def test_multi_turn(h):
    p = h.make("fine")
    assert p.chat_turns("sys", [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}, {"role": "user", "content": "c"}]) == "fine"


def test_structured_output_is_schema_constrained_and_validated(h):
    p = h.make('{"status": "ok", "number": 42}')
    ans = p.generate_structured("sys", "reply", Answer, task="test")
    assert ans == Answer(status="ok", number=42)
    call = h.calls[-1]
    if h.name == "openai":
        fmt = call["text"]["format"]
        assert fmt["type"] == "json_schema" and fmt["strict"] is True and set(fmt["schema"]["required"]) == {"status", "number"}
        assert call["store"] is False
    elif h.name == "gemini":
        cfg = call["config"]
        assert cfg.response_mime_type == "application/json" and cfg.response_json_schema["properties"]["number"]["type"] == "integer"
    elif h.name == "claude":
        fmt = call["output_config"]["format"]
        assert fmt["type"] == "json_schema" and fmt["schema"]["additionalProperties"] is False
        assert fmt["schema"]["properties"]["number"]["type"] == "integer"
        assert "temperature" not in call  # current Claude models reject sampling parameters
    else:
        assert call["format"] == "json" and '"number"' in call["messages"][-1]["content"]  # JSON mode + schema in the prompt


def test_invalid_output_is_repaired_once(h):
    p = h.make('{"status": "ok"}', '{"status": "ok", "number": 7}')
    assert p.generate_structured("sys", "reply", Answer).number == 7
    assert "not valid" in json.dumps(h.calls[-1], default=str)  # the repair call names the problem


def test_invalid_output_twice_raises_instead_of_corrupting(h):
    p = h.make('{"status": "ok"}', "still nonsense")
    with pytest.raises(AIResponseError):
        p.generate_structured("sys", "reply", Answer)


def test_timeout_is_normalized(h):
    with pytest.raises(AIProviderError) as e:
        h.make("!timeout").chat("s", "u")
    assert e.value.kind == "timeout" and e.value.fallback_ok and not e.value.retryable


@pytest.mark.parametrize("kind", ["rate_limit", "quota", "auth", "temporary", "bad_request", "unavailable", "model_missing"])
def test_errors_are_normalized_the_same_way(h, kind):
    table = {"openai": OPENAI_ERRORS, "gemini": GEMINI_ERRORS, "ollama": OLLAMA_ERRORS, "claude": CLAUDE_ERRORS}[h.name]
    if kind not in table:
        pytest.skip(f"{h.name} has no {kind} error")
    with pytest.raises(AIProviderError) as e:
        h.make("!" + kind).chat("s", "u")
    assert e.value.kind == kind and e.value.provider == h.name
    assert e.value.fallback_ok == (kind not in ("bad_request",))


def test_health_never_raises(h, monkeypatch):
    if h.name == "ollama":
        monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("down")))
        assert OllamaProvider("http://x", "m").health()["available"] is False
    else:
        p = h.make()
        assert p.health()["available"] is True
        cls = {"openai": OpenAIProvider, "gemini": GeminiProvider, "claude": ClaudeProvider}[h.name]
        assert cls(api_key="", model="m").health()["available"] is False  # no key: reported, not raised


def test_list_models(h, monkeypatch):
    if h.name == "ollama":
        monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, json={"models": [{"name": "a:1", "size": 1e9}]}, request=httpx.Request("GET", "http://x")))
        monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(200, json={"capabilities": ["completion", "vision"]}))
        assert OllamaProvider("http://x", "a:1").list_models() == [{"name": "a:1", "vision": True}]
    else:
        names = [m["name"] for m in h.make().list_models()]
        assert names == {"openai": ["m-a", "m-b"], "gemini": ["g-1"], "claude": ["claude-a", "claude-b"]}[h.name]


# ---------------------------------------------------------------------- provider-specific details
def test_openai_refusal_is_a_refusal_not_a_fallback():
    fake = OpenAIFake()
    refusal = SimpleNamespace(output_text="", status="completed", model="m", id="r", usage=None,
                              output=[SimpleNamespace(type="message", content=[SimpleNamespace(type="refusal", refusal="no")])])  # fmt: skip
    fake.responses = SimpleNamespace(create=lambda **kw: refusal)
    with pytest.raises(AIProviderError) as e:
        OpenAIProvider(model="m", client=fake).chat("s", "u")
    assert e.value.kind == "refusal" and not e.value.fallback_ok


def test_gemini_safety_block_is_a_refusal():
    fake = GeminiFake()
    fake.models.generate_content = lambda **kw: SimpleNamespace(text=None, candidates=[SimpleNamespace(finish_reason="SAFETY")],
                                                              prompt_feedback=None, usage_metadata=None, response_id=None, model_version="m")  # fmt: skip
    with pytest.raises(AIProviderError) as e:
        GeminiProvider(model="m", client=fake).chat("s", "u")
    assert e.value.kind == "refusal"


def test_claude_refusal_is_a_refusal_not_a_fallback():
    fake = ClaudeFake()
    fake.replies = [SimpleNamespace(content=[], stop_reason="refusal", stop_details=SimpleNamespace(category="cyber"), usage=None,
                                    model="m", id="x")]  # fmt: skip
    with pytest.raises(AIProviderError) as e:
        ClaudeProvider(model="m", client=fake).chat("s", "u")
    assert e.value.kind == "refusal" and not e.value.fallback_ok and e.value.details == {"category": "cyber"}


def test_claude_uses_server_side_refusal_fallback_and_effort_on_current_models():
    fake = ClaudeFake()
    fake.replies = ["ok"]
    assert ClaudeProvider(model="claude-opus-5-5", client=fake, effort="high").chat("s", "u") == "ok"
    call = fake.calls[-1]
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"]["effort"] == "high" and "thinking" not in call and "temperature" not in call


def test_claude_rate_limit_carries_retry_after_and_default_model():
    fake = ClaudeFake()
    fake.replies = [CLAUDE_ERRORS["rate_limit"]()]
    p = ClaudeProvider(client=fake)
    assert p.model == "claude-opus-5-5"
    with pytest.raises(AIProviderError) as e:
        p.chat("s", "u")
    assert e.value.kind == "rate_limit" and e.value.retry_after == 12.0


def test_claude_retries_in_json_mode_when_the_schema_is_refused():
    fake = ClaudeFake()
    fake.replies = [_c(anthropic.BadRequestError, 400, "output_config.format.schema: unsupported keyword"), '{"status": "ok", "number": 3}']
    assert ClaudeProvider(model="m", client=fake).generate_structured("sys", "reply", Answer).number == 3
    assert "format" not in fake.calls[-1]["output_config"] and '"number"' in fake.calls[-1]["system"]


def test_claude_sends_images_as_base64_blocks():
    fake = ClaudeFake()
    fake.replies = ['{"scene": "beach"}']
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 16
    ClaudeProvider(model="m", client=fake).chat_images("sys", "look", [png])
    blocks = fake.calls[-1]["messages"][0]["content"]
    assert blocks[0]["type"] == "image" and blocks[0]["source"]["media_type"] == "image/png" and blocks[-1]["type"] == "text"


def test_cloud_providers_need_a_model_and_a_key():
    with pytest.raises(AIProviderError) as e:
        OpenAIProvider(api_key="sk-test", model="").chat("s", "u")
    assert e.value.kind == "not_configured" and "OPENAI_TEXT_MODEL" in e.value.message
    with pytest.raises(AIProviderError) as e:
        GeminiProvider(api_key="", model="g").chat("s", "u")
    assert e.value.kind == "not_configured" and "GEMINI_API_KEY" in e.value.message
    with pytest.raises(AIProviderError) as e:
        ClaudeProvider(api_key="", model="claude-opus-5-5").chat("s", "u")
    assert e.value.kind == "not_configured" and "ANTHROPIC_API_KEY" in e.value.message


def test_api_keys_never_appear_in_repr_or_errors():
    key = "sk-secretsecretsecret123"
    p = OpenAIProvider(api_key=key, model="m")
    assert key not in repr(p) and key not in repr(GeminiProvider(api_key="AIzaSECRETSECRETSECRET", model="g"))
    from app.ai.types import redact

    assert key not in redact(f"Incorrect API key provided: {key}", key) and "AIzaSy" not in redact("key AIzaSyABCDEFGHIJKLMNOP")
    from app.core.config import Settings

    assert key not in repr(Settings(openai_api_key=key))


def test_cost_is_estimated_only_from_configured_prices(monkeypatch):
    from app.core.config import get_settings

    fake = OpenAIFake()
    fake.replies = ["x", "y"]
    p = OpenAIProvider(model="text-m", client=fake)
    assert p.generate(AIRequest(system="s", user="u")).cost is None  # not priced: never guessed
    monkeypatch.setenv("AI_MODEL_PRICES", json.dumps({"text": {"input": 1.0, "output": 2.0, "cached": 0.5}}))
    get_settings.cache_clear()
    # 11 in (2 cached) + 5 out: 9*1 + 2*0.5 + 5*2 = 20 USD per 1M tokens
    assert p.generate(AIRequest(system="s", user="u")).cost == pytest.approx(20 / 1_000_000)
    assert OllamaProvider("http://x", "m").estimate_cost("m", 100, 100) == 0.0  # local is free


# ---------------------------------------------------------------------- managed: retry, fallback, budget, usage
class Scripted(AIProvider):
    def __init__(self, name, outcomes, local=False):
        self.name = name
        self.model = f"{name}-m"
        self.is_local = local
        self.outcomes = list(outcomes)
        self.calls = 0

    def generate(self, req):
        self.calls += 1
        o = self.outcomes.pop(0)
        if isinstance(o, Exception):
            raise o
        return AIResult(text=o, provider=self.name, model=self.model, parsed=None, cost=0.001)

    def health(self):
        return {"available": True, "model": self.model, "detail": "ready"}


def _err(kind, provider="openai"):
    return AIProviderError("x", kind=kind, provider=provider)


def test_rate_limits_are_retried_then_succeed(_no_cloud_ai):
    p = Scripted("openai", [_err("rate_limit"), "ok"])
    m = ManagedProvider(p, task="copy", max_retries=2, sleep=lambda s: None)
    assert m.chat("s", "u") == "ok" and p.calls == 2
    rows = _no_cloud_ai.rows
    assert [r["ok"] for r in rows] == [False, True] and rows[1]["task"] == "copy" and rows[1]["cost"] == 0.001


def test_bad_requests_are_not_retried(_no_cloud_ai):
    p = Scripted("openai", [_err("bad_request")])
    with pytest.raises(AIProviderError):
        ManagedProvider(p, max_retries=3, sleep=lambda s: None).chat("s", "u")
    assert p.calls == 1


def test_fallback_on_operational_failure_only(_no_cloud_ai):
    primary, backup = Scripted("openai", [_err("quota")]), Scripted("gemini", ["from gemini"])
    m = ManagedProvider(primary, fallback=backup, max_retries=0)
    res = m.generate(AIRequest(system="s", user="u"))
    assert res.text == "from gemini" and res.fallback_used and "unavailable" in res.warnings[0]
    assert _no_cloud_ai.rows[-1]["fallbackUsed"] is True and _no_cloud_ai.rows[-1]["provider"] == "gemini"
    for kind in ("refusal", "bad_request", "invalid_response"):  # never switch provider for these
        primary, backup = Scripted("openai", [_err(kind)]), Scripted("gemini", ["no"])
        with pytest.raises(AIProviderError):
            ManagedProvider(primary, fallback=backup, max_retries=0).chat("s", "u")
        assert backup.calls == 0


def test_no_silent_switch_when_fallback_is_disabled(monkeypatch):
    from app.ai.factory import get_ai_provider
    from app.core.config import get_settings

    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_FALLBACK_PROVIDER", "gemini")
    monkeypatch.setenv("AI_FALLBACK_ENABLED", "false")
    get_settings.cache_clear()
    assert get_ai_provider("copy").fallback is None
    monkeypatch.setenv("AI_FALLBACK_ENABLED", "true")
    get_settings.cache_clear()
    assert get_ai_provider("copy").fallback.name == "gemini"


def test_task_routing(monkeypatch):
    from app.ai.factory import get_ai_provider
    from app.core.config import get_settings

    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("AI_VISION_PROVIDER", "gemini")
    monkeypatch.setenv("AI_TEXT_PROVIDER", "openai")
    get_settings.cache_clear()
    assert get_ai_provider("clip_understanding").name == "gemini"
    assert get_ai_provider("director").name == "openai" and not get_ai_provider("director").is_local
    from app.ai import ai_config

    ai_config.save(ai_config.SavedAIConfig(task_providers={"copy": "ollama"}))
    assert get_ai_provider("copy").name == "ollama" and get_ai_provider("copy").is_local


def test_budget_blocks_only_non_essential_tasks(_no_cloud_ai):
    from datetime import datetime, timezone

    from app.ai.ai_config import effective
    from app.ai.usage import set_usage_store

    set_usage_store(_no_cloud_ai)
    _no_cloud_ai.record({"ts": datetime.now(timezone.utc), "provider": "openai", "ok": True, "cost": 5.0})
    cfg = effective()
    cfg.daily_budget = 1.0
    with pytest.raises(AIProviderError) as e:
        ManagedProvider(Scripted("openai", ["x"]), task="director", config=cfg).chat("s", "u")
    assert e.value.kind == "budget" and e.value.code == "AI_BUDGET_EXCEEDED" and not e.value.fallback_ok
    assert ManagedProvider(Scripted("openai", ["chat ok"]), task="chat", config=cfg).chat("s", "u") == "chat ok"  # essential
    cfg.budget_override = True
    assert ManagedProvider(Scripted("openai", ["x"]), task="director", config=cfg).chat("s", "u") == "x"


def test_usage_summary(_no_cloud_ai):
    from app.ai.usage import record_call, summary

    record_call(provider="openai", model="m", task="copy", ok=True, latency_ms=10, cost=0.5)
    record_call(provider="gemini", model="g", task="copy", ok=False, latency_ms=10, error_code="GEMINI_TIMEOUT")
    s = summary()
    assert s["today"]["calls"] == 2 and s["today"]["ok"] == 1 and s["today"]["failed"] == 1 and s["today"]["cost"] == 0.5
    assert {p["provider"] for p in s["month"]["providers"]} == {"openai", "gemini"}


# ---------------------------------------------------------------------- the creative directors, on every provider
def test_the_reel_director_works_the_same_on_every_provider(h):
    """Same facts, same schema, same safety layer: OpenAI, Gemini and Ollama all produce a valid, exact timeline, and the
    self-correction round reaches the model the same way."""
    from app.ai.reel_director import ask_director, build_request, clip_facts
    from app.director.ai_plan import plan_to_timeline
    from app.director.music_map import build_music_map
    from app.styles import get_style, list_styles
    from tests.test_timeline import make_audio, make_clip

    audio = make_audio(duration=40)
    clips = [make_clip(f"id{i}", dur=6.0, sig_bin=i) for i in range(3)]
    mm = build_music_map(audio, 0.0, 9.0)
    styles = {s.id: s.description for s in list_styles() if s.id not in ("custom", "auto")}
    facts, alias = build_request(clips, audio, mm, 0.0, 9.0, styles, brief="", language="en", style_hint=None, captions=False,
                                 cta="", hook="", pace="balanced")  # fmt: skip
    shots = [{"clip": f"c{i + 1}", "source_start": 1.0, "source_end": 4.0, "duration": 3.0, "effect": "ken burns", "transition": "dissolve"}
             for i in range(3)]  # fmt: skip
    plan_json = json.dumps({"style": "luxury", "grade": "warm", "reason": "r", "shots": shots})
    provider = h.make(plan_json, plan_json)
    plan = ask_director(provider, facts)
    d = plan_to_timeline(plan, alias, clips, mm, 0.0, 9.0, get_style("luxury"), style_ids=set(styles), keep_style=False)
    assert d.timeline.duration == 9.0 and d.timeline.color_grade == "warm" and [s.effect for s in d.timeline.segments] == ["ken_burns"] * 3
    if h.name == "openai":  # schema-constrained: the director plan's strict JSON schema is sent
        fmt = h.calls[-1]["text"]["format"]
        assert fmt["type"] == "json_schema" and fmt["name"] == "ReelDirectorPlan" and fmt["strict"] is True
    ask_director(provider, facts, previous=plan, problems=["shot 2: moment 1.0s -> 3.0s (already shown)"])
    assert "Your previous plan broke these rules" in json.dumps(h.calls[-1], default=str)


def test_the_product_director_sees_the_photos_on_every_provider(h):
    from app.ai.product_director import ask_product_director

    direction = json.dumps({"product": "ring", "reason": "r", "phases": [{"purpose": "hook", "share": 0.3, "transition": "dissolve"},
                                                                        {"purpose": "hero", "share": 0.4}, {"purpose": "cta", "share": 0.3}]})  # fmt: skip
    provider = h.make(direction)
    d = ask_product_director(provider, {"task": "Direct this product Reel."}, [b"\xff\xd8fakejpeg"])
    assert [p.purpose for p in d.phases] == ["hook", "hero", "cta"] and d.phases[0].transition == "dissolve"
    assert h.last_model() == "vision-m"  # the photos go to the vision model



def test_a_per_minute_limit_waits_as_long_as_the_provider_asks_then_succeeds(_no_cloud_ai):
    """Gemini's per-minute limit (text mentions quota AND billing) must wait and retry, not give up as 'quota'."""
    fake = GeminiFake()
    fake.replies = [_g429("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "37s"), '{"status": "ok", "number": 42}']
    waits = []
    m = ManagedProvider(GeminiProvider(model="g", client=fake), task="director", max_retries=2, sleep=waits.append)
    assert m.chat_json("s", "u") == {"status": "ok", "number": 42}
    assert waits == [37.5]  # exactly what Gemini asked for (+ a margin)
    fake2 = GeminiFake()
    fake2.replies = [_g429("GenerateRequestsPerDayPerProjectPerModel-FreeTier", None)]
    with pytest.raises(AIProviderError) as e:
        ManagedProvider(GeminiProvider(model="g", client=fake2), max_retries=2, sleep=waits.append).chat("s", "u")
    assert e.value.kind == "quota" and "daily quota" in e.value.message and len(waits) == 1  # no pointless retry


def test_openai_retry_after_is_honoured():
    err = openai.RateLimitError("slow down", response=httpx.Response(429, request=REQ, headers={"retry-after": "12"}), body=None)
    e = OpenAIProvider(model="m", client=OpenAIFake())._normalize(err)
    assert e.kind == "rate_limit" and e.retry_after == 12.0
