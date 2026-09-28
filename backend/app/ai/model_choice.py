"""Which local model to use, chosen by the user in Settings.

The choice is a tiny JSON file in the storage folder (so it survives restarts and needs no database call inside
the synchronous provider factory). It overrides ``OLLAMA_MODEL`` from ``.env``; clearing it falls back to ``.env``.
"""

from __future__ import annotations

import json
import logging

from app.storage import get_storage

log = logging.getLogger(__name__)
KEY = "settings/ai_model.json"


def get_chosen_model() -> str | None:
    try:
        storage = get_storage()
        if not storage.exists(KEY):
            return None
        name = json.loads(storage.read_bytes(KEY).decode("utf-8")).get("model")
        return name.strip() if isinstance(name, str) and name.strip() else None
    except Exception:  # noqa: BLE001 - a damaged settings file must never take the AI features down
        log.warning("Could not read the saved AI model choice; using the .env value.")
        return None


def set_chosen_model(model: str | None) -> None:
    storage = get_storage()
    if not model:
        try:
            storage.delete(KEY)
        except Exception:  # noqa: BLE001 - nothing saved is the same as cleared
            pass
        return
    storage.write_bytes(KEY, json.dumps({"model": model.strip()}).encode("utf-8"))
