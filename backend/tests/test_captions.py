"""Phase 9: caption cues, ASS rendering, FFmpeg burn-in, and pipeline behaviour."""

from __future__ import annotations

import subprocess

import numpy as np
import pytest

from app.captions.ass import CAPTION_STYLES, ass_filter, build_ass, escape_text, get_caption_style, write_ass
from app.captions.cues import Cue, group_words
from app.captions.transcriber import CaptionsUnavailable, Word
from app.core.ffmpeg import find_binary, run_ffmpeg
from app.jobs import pipeline

WORDS = [Word(t, s, s + 0.3) for t, s in [("hello", 0.5), ("big", 0.9), ("beautiful", 1.3), ("world.", 1.7),
                                          ("second", 3.5), ("line", 3.9)]]  # fmt: skip


def test_group_words_breaks_on_sentence_and_pause():
    cues = group_words(WORDS, 10)
    assert [c.text for c in cues] == ["hello big beautiful world.", "second line"]
    assert cues[0].start == 0.5 and cues[1].start == 3.5


def test_cues_never_overlap_and_stay_in_range():
    words = [Word(f"w{i}", i * 0.35, i * 0.35 + 0.3) for i in range(40)]
    cues = group_words(words, 12)
    for a, b in zip(cues, cues[1:]):
        assert a.end <= b.start + 1e-9
    assert all(0 <= c.start < c.end <= 12 for c in cues)
    assert all(len(c.words) <= 4 for c in cues)


def test_words_outside_the_window_are_dropped_and_clamped():
    cues = group_words([Word("late", 20, 21), Word("edge", 9.8, 11), Word("neg", -1, 0.5)], 10)
    assert {w.text for c in cues for w in c.words} == {"edge", "neg"}
    assert max(c.end for c in cues) <= 10


def test_empty_transcript():
    assert group_words([], 10) == []


def test_ass_document_structure_for_every_style():
    cues = group_words(WORDS, 10)
    for name in CAPTION_STYLES:
        doc = build_ass(cues, name)
        assert "PlayResX: 1080" in doc and "PlayResY: 1920" in doc
        assert doc.count("Dialogue:") >= 2
        assert "Style: Default," in doc


def test_style_modes():
    cues = group_words(WORDS, 10)
    assert "\\kf" in build_ass(cues, "karaoke")
    hl = build_ass(cues, "highlight")
    assert hl.count("Dialogue:") == 6  # one event per word
    assert "HELLO" in build_ass(cues, "bold") and "hello" in build_ass(cues, "minimal")
    assert "\\fad(" in build_ass(cues, "luxury") and "Georgia" in build_ass(cues, "luxury")
    assert get_caption_style("nonsense").name == "minimal"


def test_transcript_text_cannot_inject_ass_overrides():
    evil = Cue(0, 2, (Word("{\\1c&H0000FF&}hack\\N", 0, 1),))
    doc = build_ass([evil], "minimal")
    body = doc.split("Dialogue:")[1]
    assert "{\\1c" not in body and "\\N" not in body
    assert escape_text("a\nb{c}") == "a b(c)"


def test_ass_filter_escapes_windows_paths(tmp_path):
    f = ass_filter(tmp_path / "it's here" / "c.ass")
    assert f.startswith("ass=filename='") and "\\\\" not in f
    assert "\\:" in f or ":" not in str(tmp_path)  # drive colon escaped on Windows
    assert "\\'" in f


def test_ffmpeg_actually_burns_captions_in(tmp_path):
    """Real render: caption pixels must appear where the cue is on screen, and only then."""
    ass = write_ass([Cue(0.5, 2.0, (Word("hello", 0.5, 1.0), Word("world", 1.0, 1.5)))], "bold",
                    tmp_path / "sub dir" / "c.ass", 360, 640)  # fmt: skip
    out = tmp_path / "o.mp4"
    run_ffmpeg(["-f", "lavfi", "-i", "color=c=black:size=360x640:rate=30:duration=3", "-vf", ass_filter(ass),
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(out)])  # fmt: skip

    def brightness(t: float) -> float:
        raw = subprocess.run(
            [find_binary("ffmpeg"), "-v", "error", "-ss", str(t), "-i", str(out), "-frames:v", "1",
             "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout  # fmt: skip
        return float(np.frombuffer(raw, np.uint8).reshape(640, 360).max())

    assert brightness(1.0) > 200, "caption text should be drawn during the cue"
    assert brightness(0.1) < 30 and brightness(2.6) < 30, "and absent outside it"


# ---------------------------------------------------------------- pipeline behaviour
def _inp(captions=True):
    from app.schemas.project import ProjectSettings

    return pipeline.PipelineInput(
        project_id="p", job_type="generate", videos=[], audio=None,
        settings=ProjectSettings(captions=captions, caption_style="bold"),
    )  # fmt: skip


def _timeline():
    from app.models.timeline import Timeline

    return Timeline(duration=10, segments=[], audio_start=2.0)


def test_build_captions_puts_editable_cues_on_the_timeline(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "transcribe_window", lambda *a, **k: WORDS)
    tl = _timeline()
    seen = []
    pipeline.build_captions(_inp(), tl, tmp_path / "a.mp3", lambda s, f: seen.append((s, f)))
    assert [c.text for c in tl.captions] == ["hello big beautiful world.", "second line"]
    assert tl.captions[0].words[0].text == "hello" and tl.caption_style == "bold"
    assert all(c.id for c in tl.captions)
    assert seen[0] == ("generating_captions", 0.0) and seen[-1] == ("generating_captions", 1.0)
    assert not tl.warnings


def test_timeline_captions_round_trip_to_ass_cues():
    from app.captions.cues import captions_to_cues, cues_to_captions

    caps = cues_to_captions(group_words(WORDS, 10))
    cues = captions_to_cues(caps)
    assert [c.text for c in cues] == [c.text for c in caps]
    assert "\\kf" in build_ass(cues, "karaoke")  # word timing survives the round trip
    from app.models.timeline import Caption

    plain = captions_to_cues([Caption(start=1, end=2, text="no words yet")])  # hand-added cue without word timing
    assert plain[0].text == "no words yet" and build_ass(plain, "minimal").count("Dialogue:") == 1


def test_build_captions_degrades_with_visible_warning(tmp_path, monkeypatch):
    def unavailable(*a, **k):
        raise CaptionsUnavailable("Captions need the optional faster-whisper package.")

    monkeypatch.setattr(pipeline, "transcribe_window", unavailable)
    tl = _timeline()
    pipeline.build_captions(_inp(), tl, tmp_path / "a.mp3", lambda *_: None)
    assert tl.captions == [] and any("Captions were skipped" in w for w in tl.warnings)

    monkeypatch.setattr(pipeline, "transcribe_window", lambda *a, **k: [])
    tl = _timeline()
    pipeline.build_captions(_inp(), tl, tmp_path / "a.mp3", lambda *_: None)
    assert tl.captions == [] and any("no speech" in w for w in tl.warnings)


def test_caption_stage_only_when_enabled():
    assert "generating_captions" not in pipeline.stage_names("generate")
    names = pipeline.stage_names("generate", captions=True)
    assert names.index("creating_timeline") < names.index("generating_captions") < names.index("rendering")
    assert "generating_captions" not in pipeline.stage_names("analyze", captions=True)
    assert pipeline.overall_progress("generate", "rendering", 1.0, True) == 100


def test_missing_faster_whisper_is_a_clean_error(monkeypatch, tmp_path):
    import builtins
    import sys

    from app.captions import transcriber

    monkeypatch.setattr(transcriber, "_model", None)
    real = builtins.__import__

    def fake(name, *a, **k):
        if name == "faster_whisper":
            raise ImportError("no")
        return real(name, *a, **k)

    monkeypatch.delitem(sys.modules, "faster_whisper", raising=False)
    monkeypatch.setattr(builtins, "__import__", fake)
    with pytest.raises(CaptionsUnavailable) as e:
        transcriber._load_model()
    assert e.value.code == "CAPTIONS_UNAVAILABLE"
