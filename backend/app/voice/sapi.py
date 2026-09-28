"""Windows SAPI voices (offline). Other engines (Piper, espeak, cloud) implement ``VoiceProvider`` too."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from app.voice.base import VoiceInfo, VoiceProvider, VoiceUnavailable

SCRIPT = Path(__file__).with_name("sapi_speak.ps1")
BASE = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]


class SapiProvider(VoiceProvider):
    name = "sapi"

    def __init__(self) -> None:
        self._voices: list[VoiceInfo] | None = None

    def _powershell(self) -> str | None:
        return shutil.which("powershell") or shutil.which("pwsh") if sys.platform == "win32" else None

    def available(self) -> bool:
        return self._powershell() is not None and SCRIPT.exists()

    def _run(self, args: list[str], timeout: float = 120) -> str:
        ps = self._powershell()
        if not ps:
            raise VoiceUnavailable("Offline voices need Windows (SAPI) or another installed voice engine.")
        try:
            r = subprocess.run([ps, *BASE, str(SCRIPT), *args], capture_output=True, text=True, timeout=timeout,
                               encoding="utf-8", errors="replace")  # fmt: skip
        except subprocess.TimeoutExpired as exc:
            raise VoiceUnavailable("The voice engine took too long to respond.") from exc
        if r.returncode != 0:
            raise VoiceUnavailable("The voice engine failed.", details=(r.stderr or r.stdout)[-400:])
        return r.stdout

    def list_voices(self) -> list[VoiceInfo]:
        if self._voices is not None:
            return self._voices
        if not self.available():
            return []
        try:
            data = json.loads(self._run(["-List"], timeout=30) or "[]")
        except (ValueError, VoiceUnavailable):
            return []
        data = data if isinstance(data, list) else [data]
        self._voices = [VoiceInfo(id=v["name"], name=v["name"], language=v.get("culture", ""), gender=v.get("gender", ""),
                                  provider=self.name) for v in data]  # fmt: skip
        return self._voices

    def synthesize(self, ssml: str, voice_id: str, out: Path) -> None:
        known = {v.id for v in self.list_voices()}
        if voice_id not in known:  # never pass an unvalidated name to the engine
            raise VoiceUnavailable(f"The voice '{voice_id[:60]}' is not installed.", details={"installed": sorted(known)})
        with tempfile.TemporaryDirectory(prefix="reel_tts_") as tmp:
            f = Path(tmp) / "line.ssml"
            f.write_text(ssml, encoding="utf-8")
            out.parent.mkdir(parents=True, exist_ok=True)
            self._run(["-SsmlFile", str(f), "-OutFile", str(out.resolve()), "-Voice", voice_id])
        if not out.exists() or out.stat().st_size < 100:
            raise VoiceUnavailable("The voice engine produced no audio.")


_provider: VoiceProvider | None = None


def get_voice_provider() -> VoiceProvider:
    global _provider
    if _provider is None:
        _provider = SapiProvider()
    return _provider


def set_voice_provider(provider: VoiceProvider | None) -> None:
    global _provider
    _provider = provider
