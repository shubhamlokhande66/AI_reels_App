"""On-screen text in English, Hindi and Marathi: the right font, joined letters, readable size, nothing cut off."""

from __future__ import annotations

from app.captions.ass import build_ass
from app.captions.cues import Cue, Word
from app.core import fonts
from app.models.timeline import Segment, TextOverlay, Timeline
from app.product.models import TextLayer
from app.product.textass import layer_events
from app.video.overlays import normalize, to_layers, wrap_lines, write_overlays_ass

MR = "बाप्पा गेले… पण मन अजूनही त्यांच्यातच आहे"
HI = "बप्पा चले गए… पर दिल अभी भी उन्हीं में है"
EN = "Bappa left… but my heart is still with him"


def test_script_detection():
    assert fonts.script_of(MR) == "devanagari" and fonts.script_of(HI) == "devanagari"
    assert fonts.script_of(EN) is None and not fonts.needs_shaping("Hello… 123")
    assert fonts.script_of("વડોદરા") == "gujarati" and fonts.script_of("தமிழ்") == "tamil"


def test_font_for_keeps_latin_and_picks_a_devanagari_font(monkeypatch):
    monkeypatch.setattr(fonts, "_families", lambda: frozenset({"noto sans devanagari"}))
    assert fonts.font_for(EN, "Arial") == "Arial"
    assert fonts.font_for(MR, "Arial") == "Noto Sans Devanagari"
    monkeypatch.setattr(fonts, "_families", lambda: frozenset())
    assert fonts.font_for(MR, "Georgia") == "Nirmala UI"  # nothing found: the best-known name, never Georgia


def _tl(text, **kw):
    seg = Segment(clip_id="c", video="c", source_start=0, source_end=3, timeline_start=0, timeline_end=3)
    return Timeline(duration=3, segments=[seg], overlays=[TextOverlay(text=text, start=0, end=3, role="hook", **kw)])


def test_user_text_is_never_cut_in_any_language(tmp_path):
    for text in (MR, HI, EN):
        overlays, notes = normalize(_tl(text).overlays, 3)
        assert overlays[0].text == text and not notes


def test_devanagari_gets_its_font_and_no_letter_spacing(tmp_path, monkeypatch):
    monkeypatch.setattr(fonts, "_families", lambda: frozenset({"nirmala ui"}))
    body = write_overlays_ass(_tl(MR), tmp_path / "t.ass", 1080, 1920).read_text(encoding="utf-8")
    line = body.splitlines()[-1]
    assert r"\fnNirmala UI\fsp0" in line and "त्यांच्यातच" in line
    en = write_overlays_ass(_tl(EN), tmp_path / "e.ass", 1080, 1920).read_text(encoding="utf-8").splitlines()[-1]
    assert r"\fn" not in en and "with him" in en


def test_long_text_wraps_onto_balanced_lines_and_stays_big():
    assert wrap_lines("Wait for it") == ["Wait for it"]
    lines = wrap_lines(EN)
    assert len(lines) == 2 and " ".join(lines) == EN and abs(len(lines[0]) - len(lines[1])) <= 6
    assert len(wrap_lines("one two three four five six seven eight nine ten eleven twelve")) == 3
    layer = to_layers(normalize(_tl(MR).overlays, 3)[0], False, 1080, 1920)[0]
    assert layer.text.count("\n") == 1 and layer.size >= 0.035  # one long line would be about 0.02 (too small on a phone)


def test_video_text_sits_on_a_box(tmp_path):
    head = write_overlays_ass(_tl(EN), tmp_path / "t.ass", 1080, 1920).read_text(encoding="utf-8")
    style = next(x for x in head.splitlines() if x.startswith("Style: Default"))
    assert style.split(",")[15] == "3"  # BorderStyle 3 = opaque box


def test_type_on_does_not_split_joined_letters():
    ev = layer_events(TextLayer(id="t", text=MR, start=0, end=3, animation_in="type_on"), 1080, 1920)
    assert len(ev) == 1  # shown whole (fade) instead of letter by letter


def test_captions_in_marathi_use_a_devanagari_font(monkeypatch):
    monkeypatch.setattr(fonts, "_families", lambda: frozenset({"nirmala ui"}))
    cue = Cue(0, 2, tuple(Word(w, 0, 2) for w in MR.split()))
    style = next(x for x in build_ass([cue], "luxury").splitlines() if x.startswith("Style:"))
    assert ",Nirmala UI," in style and style.split(",")[13] == "0"  # luxury's letter spacing is off for Devanagari
    latin = next(x for x in build_ass([Cue(0, 2, (Word("Hello", 0, 2),))], "luxury").splitlines() if x.startswith("Style:"))
    assert ",Georgia," in latin
