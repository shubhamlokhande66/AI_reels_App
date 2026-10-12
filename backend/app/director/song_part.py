"""Which part of the song the Reel uses, when the person did not choose one.

The music analysis ranks the song's best windows for the Reel's length (video/timeline.rank_music_windows: a strong
start, a drop or chorus inside, a clean phrase ending). The AI then picks among the top ones with what only it can
weigh: the person's instructions ("start with the calm intro", "use the chorus"), the creative concept and the footage
(calm product shots vs. high-energy action). Without AI, or if it fails, the best window is used, and a regenerated
version (another seed) rotates through the top three, so the same song does not always give the same part.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.errors import AppError
from app.models.analysis import AudioAnalysis

log = logging.getLogger(__name__)
TOP = 5

SYSTEM = "You are a music editor choosing which part of a song a short vertical video (Reel) uses. Reply with JSON only."


def _fmt(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def describe(audio: AudioAnalysis, cands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, c in enumerate(cands):
        labels = []
        if audio.song_sections:
            for sec in audio.song_sections:
                if sec.end > c["start"] and sec.start < c["end"] and sec.label not in labels:
                    labels.append(sec.label)
        out.append({"index": i, "from": _fmt(c["start"]), "to": _fmt(c["end"]), "song_parts": labels,
                    "energy": round(audio.mean_energy(c["start"], c["end"]), 2), "why_good": c.get("reasons", [])[:4]})  # fmt: skip
    return out


def choose_song_part(audio: AudioAnalysis, duration: float, brief: str, concept: str | None, footage: str, seed: int,
                     use_ai: bool, provider: Any = None) -> tuple[float | None, str]:  # fmt: skip
    """(start in seconds, a note for the person), or (None, "") to keep the default."""
    from app.video.timeline import rank_music_windows

    cands = rank_music_windows(audio, duration, TOP)
    if len(cands) < 2:
        return None, ""
    fallback = seed % min(3, len(cands)) if seed else 0
    if use_ai:
        try:
            if provider is None:
                from app.ai.provider import get_provider

                provider = get_provider("music")
            user = {
                "reel_seconds": duration, "instructions": brief or "(none)", "concept": concept or "auto", "footage": footage,
                "new_version": bool(seed),  # a regenerated version: prefer a different part than candidate 0, unless asked for one
                "candidates": describe(audio, cands),
                "task": "Choose the candidate that best fits the instructions, concept and footage. Calm or luxury footage suits "
                        "softer, elegant parts; action and celebration suit the drop or chorus. If the instructions name a part "
                        "(intro, chorus, drop, a time), follow them. For a new version pick a different candidate than 0 unless the "
                        "instructions name a part. Return {\"pick\": <index>, \"reason\": \"<short, for the person>\"}.",
            }  # fmt: skip
            import json

            ans = provider.chat_json(SYSTEM, json.dumps(user, ensure_ascii=False), temperature=0.0, task="music")
            pick = int(ans.get("pick", -1))
            if 0 <= pick < len(cands):
                c = cands[pick]
                reason = str(ans.get("reason", "")).strip()[:160]
                return c["start"], f"AI chose the song part {_fmt(c['start'])}–{_fmt(c['end'])}" + (f": {reason}" if reason else ".")
        except (AppError, ValueError, TypeError, KeyError) as exc:
            log.info("song part chosen without AI: %s", getattr(exc, "message", exc))
    c = cands[fallback]
    note = "" if fallback == 0 else f"A different part of the song for this version: {_fmt(c['start'])}–{_fmt(c['end'])}."
    return (c["start"], note) if fallback else (None, "")
