"""Settings: choosing the local model, and the quick model test."""

from __future__ import annotations

import json

import httpx
import pytest

from app.ai.model_choice import get_chosen_model, set_chosen_model
from app.ai.provider import get_provider

MODELS = {
    "gemma3:4b": {"size": 3.3e9, "capabilities": ["completion", "vision"]},
    "qwen3.5:4b": {"size": 3.4e9, "capabilities": ["completion", "vision", "tools", "thinking"]},
}


@pytest.fixture(autouse=True)
def _ollama(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "gemma3:4b")
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    calls: list[tuple[str, dict]] = []

    def get(url, **kw):
        assert url.endswith("/api/tags")
        return httpx.Response(200, json={"models": [{"name": n, "size": m["size"]} for n, m in MODELS.items()]}, request=httpx.Request("GET", url))

    def post(url, json=None, **kw):
        calls.append((url, json))
        if url.endswith("/api/show"):
            return httpx.Response(200, json={"capabilities": MODELS[json["model"]]["capabilities"]})
        if url.endswith("/api/chat"):
            return httpx.Response(200, json={"message": {"content": reply["text"]}})
        raise AssertionError(url)

    reply = {"text": '{"actions":[{"action":"music_volume","factor":1.3},{"action":"speed","scope":"last","factor":0.75}],"unclear":""}'}
    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(httpx, "post", post)
    return {"calls": calls, "reply": reply}


async def test_lists_installed_models_with_what_each_can_do(client):
    j = (await client.get("/api/ai/models")).json()
    assert j["reachable"] and j["current"] == "gemma3:4b" and j["source"] == "env"
    by = {m["name"]: m for m in j["models"]}
    assert by["gemma3:4b"]["current"] and by["gemma3:4b"]["vision"] and not by["gemma3:4b"]["thinking"]
    assert by["qwen3.5:4b"]["thinking"] and by["qwen3.5:4b"]["sizeGb"] == 3.4 and not by["qwen3.5:4b"]["current"]


async def test_choice_is_saved_used_everywhere_and_can_be_cleared(client):
    r = await client.put("/api/ai/model", json={"model": "qwen3.5:4b"})
    j = r.json()
    assert r.status_code == 200 and j["current"] == "qwen3.5:4b" and j["source"] == "settings"
    assert get_chosen_model() == "qwen3.5:4b" and get_provider().model == "qwen3.5:4b"  # every AI feature follows it
    assert (await client.get("/api/health")).json()["ai"]["model"] in ("qwen3.5:4b", None)
    cleared = (await client.put("/api/ai/model", json={"model": None})).json()
    assert cleared["current"] == "gemma3:4b" and cleared["source"] == "env" and get_provider().model == "gemma3:4b"


async def test_cannot_choose_a_model_that_is_not_installed(client):
    r = await client.put("/api/ai/model", json={"model": "llama99:1b"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "MODEL_NOT_INSTALLED" and "ollama pull llama99:1b" in r.json()["error"]["message"]
    assert get_chosen_model() is None


def test_a_damaged_settings_file_falls_back_to_env(storage):
    storage.write_bytes("settings/ai_model.json", b"{not json")
    assert get_chosen_model() is None and get_provider().model == "gemma3:4b"
    storage.write_bytes("settings/ai_model.json", json.dumps({"model": 5}).encode())
    assert get_chosen_model() is None


async def test_unreachable_ollama_is_reported_not_raised(client, monkeypatch):
    def down(url, **kw):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(httpx, "get", down)
    j = (await client.get("/api/ai/models")).json()
    assert j["reachable"] is False and j["models"] == [] and "Cannot reach Ollama" in j["detail"]


async def test_model_test_grades_the_answer_and_changes_nothing(client, _ollama):
    j = (await client.post("/api/ai/models/test", json={"model": "qwen3.5:4b"})).json()
    assert j["verdict"] == "correct" and j["ok"] and j["model"] == "qwen3.5:4b" and j["seconds"] >= 0
    chat = [c for c in _ollama["calls"] if c[0].endswith("/api/chat")][0][1]
    assert chat["model"] == "qwen3.5:4b" and chat["think"] is False  # the tested model, with reasoning off
    assert get_chosen_model() is None  # testing never switches the model

    _ollama["reply"]["text"] = '{"actions":[{"action":"music_volume","factor":1.3},{"action":"speed","scope":"last","factor":0.75},{"action":"style","value":"luxury"}]}'
    j = (await client.post("/api/ai/models/test", json={"model": "gemma3:4b"})).json()
    assert j["verdict"] == "over-eager" and not j["ok"] and "style" in j["detail"]

    _ollama["reply"]["text"] = '{"actions":[{"action":"pace","value":"calm"}]}'
    assert (await client.post("/api/ai/models/test", json={"model": "gemma3:4b"})).json()["verdict"] == "wrong"

    _ollama["reply"]["text"] = "I am sorry, I cannot do that"
    j = (await client.post("/api/ai/models/test", json={"model": "gemma3:4b"})).json()
    assert j["verdict"] == "failed" and not j["ok"]


async def test_model_test_rejects_unknown_models(client):
    r = await client.post("/api/ai/models/test", json={"model": "nope:1b"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "MODEL_NOT_INSTALLED"


def test_set_and_clear_roundtrip(storage):
    set_chosen_model("gemma3:4b")
    assert get_chosen_model() == "gemma3:4b"
    set_chosen_model(None)
    assert get_chosen_model() is None
    set_chosen_model(None)  # clearing twice is fine
