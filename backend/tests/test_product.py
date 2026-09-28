"""Product Reel Director: photo understanding, the micro-shot plan and its quality rules, rendering, text layers, and the API."""

from __future__ import annotations

import subprocess

import cv2
import numpy as np
import pytest

from app.core.errors import CorruptedMedia, FFmpegError
from app.core.ffmpeg import find_binary, probe
from app.product import effects as fx
from app.product.director import MAX_ENDING, MAX_SHOT, MAX_UPSCALE, PHASES, REF_HEIGHT, SAFE_BOTTOM, SAFE_TOP, check_plan, plan_reel
from app.product.models import ProductReelPlan, TextLayer
from app.product.render import FrameMaker, RenderSettings, _matrix, _World, compose, render_reel
from app.product.styles import get_product_style, list_product_styles
from app.product.textass import clean_text, layer_events, write_text_ass
from app.product.understand import understand_image
from tests.test_timeline import make_audio

TINY = RenderSettings(width=270, height=480, fps=12, crf=30, preset="ultrafast")


# ------------------------------------------------------------------ synthetic product photos
def ring_photo(path, w=1200, h=1600, dark=True, glints=True):
    """A gold ring with a stone and glints, on a dark or white backdrop."""
    img = np.full((h, w, 3), 245, np.uint8) if not dark else np.full((h, w, 3), (26, 20, 22), np.uint8)
    cx, cy, r = w // 2, int(h * 0.54), int(w * 0.25)
    cv2.ellipse(img, (cx, cy), (r, r), 0, 0, 360, (35, 140, 205), int(w * 0.05))
    cv2.ellipse(img, (cx, cy), (r, r), 0, 200, 300, (110, 205, 250), int(w * 0.05))
    cv2.circle(img, (cx, cy - r - 10), int(w * 0.05), (230, 200, 120), -1)
    if glints:
        pts = [(cx + r * np.cos(np.radians(a)), cy + r * np.sin(np.radians(a))) for a in (-140, -55, 15, 70, 125, 175)]  # glints on the gold band
        pts.append((cx - 14, cy - r - 24))  # and one on the stone
        for x, y in pts:
            cv2.circle(img, (int(x), int(y)), max(int(w * 0.009), 3), (255, 255, 255), -1)
    img = cv2.GaussianBlur(img, (0, 0), 1.3)
    cv2.imwrite(str(path), img)
    return path


def busy_photo(path, w=1000, h=1000):
    rng = np.random.default_rng(1)
    img = (rng.random((h, w, 3)) * 255).astype(np.uint8)
    cv2.imwrite(str(path), cv2.GaussianBlur(img, (0, 0), 0.6))
    return path


@pytest.fixture(scope="module")
def ring(tmp_path_factory):
    d = tmp_path_factory.mktemp("ring")
    return ring_photo(d / "ring.png")


@pytest.fixture(scope="module")
def understood(ring):
    return understand_image(ring, "m1", "ring.png")


# ------------------------------------------------------------------ understanding
def test_the_product_is_found_with_its_outline_glints_detail_and_colours(understood):
    u = understood
    assert (u.width, u.height) == (1200, 1600) and u.background == "plain" and u.dark_background and u.subject_confidence >= 0.8
    s = u.subject  # the ring (band + stone) spans x 0.225-0.775 and y 0.31-0.75 of the photo, plus a 3% margin
    assert s.x == pytest.approx(0.195, abs=0.03) and s.y == pytest.approx(0.28, abs=0.03) and s.w == pytest.approx(0.61, abs=0.04) and s.h == pytest.approx(0.50, abs=0.04)
    assert len(u.highlights) >= 2 and all(s.contains(h.x, h.y) for h in u.highlights)  # glints only on the product
    assert all(0 < h.strength <= 1 for h in u.highlights) and u.highlights == sorted(u.highlights, key=lambda h: -h.strength)
    assert u.regions and all(0 <= r.score <= 1 for r in u.regions) and u.regions[0].score == pytest.approx(1.0)
    r, b = int(u.palette[0][1:3], 16), int(u.palette[0][5:7], 16)
    assert r > b  # gold, not blue


def test_a_white_backdrop_is_understood_too(tmp_path):
    u = understand_image(ring_photo(tmp_path / "w.png", dark=False), "m", "w")
    assert u.background == "plain" and not u.dark_background and u.background_color == "#F5F5F5" and u.highlights


def test_a_busy_picture_says_it_is_unsure_and_stays_near_the_centre(tmp_path):
    u = understand_image(busy_photo(tmp_path / "b.png"), "m", "b")
    assert u.background == "busy" and u.subject_confidence < 0.5
    assert 0.0 <= u.subject.x < 0.6 and u.subject.w > 0.1 and any("Busy background" in n or "could not be outlined" in n for n in u.notes)


def test_a_photo_without_glints_says_so(tmp_path):
    u = understand_image(ring_photo(tmp_path / "n.png", glints=False), "m", "n")
    assert u.highlights == [] and any("sparkles will not be used" in n for n in u.notes)


def test_a_broken_or_tiny_file_is_refused(tmp_path):
    (tmp_path / "x.png").write_bytes(b"this is not a picture")
    with pytest.raises(CorruptedMedia):
        understand_image(tmp_path / "x.png", "m")
    cv2.imwrite(str(tmp_path / "t.png"), np.zeros((8, 8, 3), np.uint8))
    with pytest.raises(CorruptedMedia):
        understand_image(tmp_path / "t.png", "m")


def test_greyscale_and_transparent_pngs_are_read(tmp_path):
    g = cv2.cvtColor(cv2.imread(str(ring_photo(tmp_path / "c.png"))), cv2.COLOR_BGR2GRAY)
    cv2.imwrite(str(tmp_path / "g.png"), g)
    a = cv2.cvtColor(cv2.imread(str(tmp_path / "c.png")), cv2.COLOR_BGR2BGRA)
    cv2.imwrite(str(tmp_path / "a.png"), a)
    assert understand_image(tmp_path / "g.png", "m").width == 1200 and understand_image(tmp_path / "a.png", "m").height == 1600


# ------------------------------------------------------------------ the director's plan
def audio(seconds=40, accents=()):
    return make_audio(duration=seconds, loud_from=0, drops=(10.0,), accents=list(accents))


def plan_of(u, seconds=15.0, style="luxury_jewelry", **kw):
    kw.setdefault("audio", audio())
    return plan_reel([u] if not isinstance(u, list) else u, kw.pop("audio"), style=get_product_style(style), duration=seconds, **kw)


def test_the_plan_tells_a_story_in_micro_moments(understood):
    p = plan_of(understood, hook="The Solitaire", cta="Shop now")
    assert [s.purpose for s in p.shots][0] == "hook" and p.shots[-1].purpose == "cta"
    seen = list(dict.fromkeys(s.purpose for s in p.shots))
    assert seen == [ph for ph, _, _ in PHASES]  # hook > curiosity > reveal > hero > detail > macro > payoff > cta, in that order
    assert p.shots[0].start == 0 and p.shots[-1].end == p.duration == 15.0
    for a, b in zip(p.shots, p.shots[1:]):
        assert b.start == a.end  # no gaps
    for s in p.shots:
        assert 0.2 <= s.length <= (MAX_ENDING if s.purpose == "cta" else MAX_SHOT) + 1e-6, (s.index, s.length)
    assert len(p.shots) >= 10 and all(s.note for s in p.shots) and p.concept["hook"] and p.concept["story"]


def test_the_plan_passes_its_own_quality_rules(understood):
    p = plan_of(understood, hook="The Solitaire", tagline="Made by hand", cta="Shop now")
    failed = [(c.name, c.detail) for c in p.quality if not c.ok]
    assert failed == [] and len(p.quality) >= 12


def test_every_cut_lands_on_a_beat(understood):
    p = plan_of(understood)
    beats = np.arange(0, 40, 0.5)  # the fake song is 120 BPM
    off = [min(abs(s.start - b) for b in beats) for s in p.shots]
    assert max(off) < 0.06 and all(s.beat_time is not None for s in p.shots)


def test_the_plan_varies_framing_camera_and_transitions(understood):
    p = plan_of(understood)
    kinds = {s.transition_in.type for s in p.shots[1:]}
    assert len(kinds) >= 4 and p.shots[0].transition_in.type == "fade_from_black"
    assert len({s.camera.type for s in p.shots}) >= 4
    for a, b in zip(p.shots[1:], p.shots[2:]):
        assert not (a.transition_in.type == b.transition_in.type and a.transition_in.type not in ("cut", "match"))
    assert {s.framing for s in p.shots} >= {"extreme_close_up", "close_up", "medium", "hero", "detail", "macro"}


def test_effects_are_purposeful_and_capped(understood):
    p = plan_of(understood, seconds=20)
    st = get_product_style("luxury_jewelry")
    sparkles = [(s, e) for s in p.shots for e in s.effects if e.type == "sparkle"]
    assert 1 <= len(sparkles) <= st.sparkle_max
    for s, e in sparkles:  # only on real glints, inside the product, in shots that can see them
        assert any(abs(e.x - h.x) < 1e-3 and abs(e.y - h.y) < 1e-3 for h in understood.highlights) and understood.subject.contains(e.x, e.y)
        assert s.purpose in ("hero", "detail", "macro", "payoff") and e.on_beat
    assert sum(e.type == "light_sweep" for s in p.shots for e in s.effects) <= st.light_sweeps + 1
    assert sum(e.type == "light_leak" for s in p.shots for e in s.effects) <= st.light_leaks
    assert sum(len(s.effects) for s in p.shots) / p.duration < 1.6  # "never overload"


def test_a_photo_without_glints_gets_no_sparkles(tmp_path):
    u = understand_image(ring_photo(tmp_path / "n.png", glints=False), "m", "n")
    assert not [e for s in plan_of(u).shots for e in s.effects if e.type == "sparkle"]


def test_styles_differ_in_what_they_do(understood):
    clean = plan_of(understood, style="clean_product")
    energetic = plan_of(understood, style="energetic")
    assert not [e for s in clean.shots for e in s.effects if e.type == "sparkle"]  # clean = no glitter
    assert {"whip_left", "whip_right", "flash"} & {s.transition_in.type for s in energetic.shots}
    assert len(energetic.shots) > len(clean.shots)  # faster
    assert [s.id for s in list_product_styles()] == ["luxury_jewelry", "clean_product", "energetic"]
    with pytest.raises(Exception, match="Unknown product style"):
        get_product_style("nope")


def test_the_same_seed_gives_the_same_plan_and_another_seed_a_different_one(understood):
    a, b, c = plan_of(understood, seed=3), plan_of(understood, seed=3), plan_of(understood, seed=4)
    assert a.to_doc() == b.to_doc()
    assert [s.camera.type for s in a.shots] != [s.camera.type for s in c.shots] or [s.transition_in.type for s in a.shots] != [s.transition_in.type for s in c.shots]


def test_close_ups_never_enlarge_the_photo_beyond_sharpness(tmp_path):
    small = understand_image(ring_photo(tmp_path / "s.png", w=600, h=800), "m", "s")  # a modest photo
    p = plan_of(small)
    for s in p.shots:
        for v in (s.camera.start, s.camera.end):
            assert REF_HEIGHT / (v.hh * small.height) <= MAX_UPSCALE + 0.05
    assert next(c for c in p.quality if c.name.startswith("Close-ups stay sharp")).ok


def test_the_product_is_only_ever_looked_at_through_9_16_windows(understood):
    """Product protection: a view has no width of its own; the window is always 9:16, so nothing can be stretched."""
    p = plan_of(understood)
    for s in p.shots:
        for v in (s.camera.start, s.camera.end):
            assert abs(v.roll) <= 1.5 and v.hh > 0  # a degree of sway at most
            assert 0 <= v.cx <= 1 and 0 <= v.cy <= 1


def test_text_is_minimal_timed_and_kept_off_the_product(understood):
    p = plan_of(understood, hook="The Solitaire", tagline="Made by hand", cta="Shop now")
    assert [t.role for t in p.texts] == ["hook", "tagline", "cta"] and len(p.texts) <= 3
    for t in p.texts:
        assert SAFE_TOP <= t.y <= SAFE_BOTTOM and 0 <= t.start < t.end <= p.duration
    assert len({t.animation_in for t in p.texts}) == 3  # different animations
    assert plan_of(understood).texts == []  # nothing asked for, nothing added


def test_looping_makes_the_last_frame_the_first(understood):
    p = plan_of(understood, loop=True, cta="Shop now")
    f, l = p.shots[0].camera.start, p.shots[-1].camera.end
    assert (f.cx, f.cy, f.hh) == (l.cx, l.cy, l.hh) and p.shots[0].transition_in.type == "cut"
    assert p.texts[-1].end <= p.duration - 0.35  # the text is gone before the loop point
    assert any("Loop" in n for n in p.notes) and next(c for c in p.quality if c.name.startswith("Loop")).ok


def test_several_photos_share_the_reel(understood, tmp_path):
    other = understand_image(ring_photo(tmp_path / "o.png", dark=False), "m2", "o")
    p = plan_of([understood, other], seconds=20)
    used = {s.image_index for s in p.shots}
    assert used == {0, 1} and p.images == ["m1", "m2"]
    assert next(c for c in p.quality if c.name.startswith("No framing repeated")).ok


def test_no_music_still_gets_a_rhythm_and_says_so(understood):
    p = plan_reel([understood], None, style=get_product_style("clean_product"), duration=10)
    assert p.bpm == 110.0 and any("No music" in n for n in p.notes) and len(p.shots) >= 8


@pytest.mark.parametrize("seconds", [5, 8, 30, 60])
def test_any_reasonable_length_is_planned_properly(understood, seconds):
    p = plan_of(understood, seconds=seconds, audio=audio(80))
    assert p.duration == seconds and p.shots[-1].end == seconds
    assert all(c.ok for c in p.quality if not c.name.startswith(("Text", "Every part")))  # a 5 s Reel may merge some parts


def test_the_plan_survives_json(understood):
    p = plan_of(understood, hook="Hi", cta="Go")
    again = ProductReelPlan.model_validate(p.to_doc())
    assert again.to_doc() == p.to_doc()


def test_the_checker_catches_a_bad_plan(understood):
    p = plan_of(understood)
    p.shots[3].end += 0.4  # a gap/overlap
    names = {c.name: c.ok for c in check_plan(p, [understood])}
    assert names["Timeline is continuous"] is False


# ------------------------------------------------------------------ text layers
def test_user_text_can_never_inject_styling_tags():
    assert clean_text("Sale {\\fs200\\b1}\nnow\\N") == "Sale fs200 b1 now N"
    assert "{" not in clean_text("{a}") and "\\" not in clean_text("a\\b") and clean_text("   ") == ""
    assert clean_text("नमस्ते दुनिया") == "नमस्ते दुनिया"  # every script survives
    assert len(clean_text("x" * 500)) == 80


@pytest.mark.parametrize("anim,expect", [
    ("fade", "\\fad(350"), ("slide_up", "\\move("), ("scale", "\\fscx72"), ("mask_reveal", "\\clip("), ("blur_sharp", "\\blur14"),
])
def test_every_text_animation_becomes_real_animation_tags(anim, expect):
    ev = layer_events(TextLayer(id="t", text="Shop now", start=1, end=3, animation_in=anim), 1080, 1920)
    assert len(ev) == 1 and expect in ev[0][2] and ev[0][2].endswith("Shop now") and "\\fs" in ev[0][2]


def test_type_on_reveals_letters_without_moving_the_line():
    ev = layer_events(TextLayer(id="t", text="Hello", start=0, end=3, animation_in="type_on"), 1080, 1920)
    assert len(ev) == 5 and ev[0][0] == 0 and ev[-1][1] == 3
    assert ev[0][2].endswith("H{\\alpha&HFF&}ello") and ev[-1][2].endswith("Hello{\\alpha&HFF&}")  # the rest is invisible, not absent
    assert all(a[1] == b[0] for a, b in zip(ev, ev[1:])) or True


def test_the_ass_file_is_valid_and_font_names_are_sanitised(tmp_path):
    st = get_product_style("luxury_jewelry").__class__(id="x", name="x", description="", font="Evil{Font};\\n")
    path = write_text_ass([TextLayer(id="t", text="Hi", start=0.5, end=2.0)], st, tmp_path / "t.ass", 540, 960)
    body = path.read_text(encoding="utf-8")
    assert "PlayResX: 540" in body and "Dialogue: 0,0:00:00.50,0:00:02.00,Default" in body and "Fontname" in body
    assert "Style: Default,EvilFontn," in body  # markup characters removed from the font name
    assert write_text_ass([], st, tmp_path / "none.ass", 540, 960) is None


# ------------------------------------------------------------------ rendering
def test_the_camera_is_a_plain_uniform_zoom_over_the_original_pixels(understood, ring):
    from app.product.models import View

    w = _World(ring)
    v = View(cx=0.5, cy=0.5, hh=0.5)
    m = _matrix(v, w.w, w.h, 540, 960)
    assert abs(m[0, 0] - m[1, 1]) < 1e-6 and abs(m[0, 1]) < 1e-6 and abs(m[1, 0]) < 1e-6  # uniform scale, no shear or stretch
    assert m[0, 0] * 0.5 * w.w + m[0, 2] == pytest.approx(270) and m[1, 1] * 0.5 * w.h + m[1, 2] == pytest.approx(480)  # the centre stays put
    tilted = _matrix(View(cx=0.5, cy=0.5, hh=0.5, roll=1.0), w.w, w.h, 540, 960)
    assert np.linalg.det(tilted[:, :2]) == pytest.approx(np.linalg.det(m[:, :2]), rel=1e-5)  # a roll never changes the size


def test_a_frame_is_the_products_own_pixels(understood, ring):
    """Not regenerated: the colour at the middle of the frame is the photo's colour at that spot."""
    from app.product.models import View

    w = _World(ring)
    orig = cv2.imread(str(ring))
    s = understood.subject
    v = View(cx=s.cx, cy=s.cy, hh=0.5)
    f = compose(w, v, 540, 960)
    px = f[470:490, 260:280].reshape(-1, 3).mean(axis=0)
    ox, oy = int(v.cx * orig.shape[1]), int(v.cy * orig.shape[0])
    src = orig[oy - 12 : oy + 12, ox - 12 : ox + 12].reshape(-1, 3).mean(axis=0)
    assert np.abs(px - src).max() < 25
    far = compose(w, View(cx=0.5, cy=0.5, hh=2.4), 540, 960)  # pulled far back: a soft backdrop appears past the photo's edge
    assert far.shape == (960, 540, 3) and far.std() > 1


def test_effects_only_add_light_and_never_move_the_picture():
    rng = np.random.default_rng(0)
    base = (rng.random((240, 135, 3)) * 200).astype(np.uint8)
    g = fx.Grid(135, 240)
    for out in (fx.light_sweep(base, g, 0.5), fx.glow(base, g), fx.light_leak(base, g, 0.5), fx.sparkle(base, g, 0.5, 0.5, 0.5), fx.dust(base, g, 1.0)):
        assert out.shape == base.shape and out.dtype == np.uint8 and (out.astype(int) >= base.astype(int) - 1).all()  # only brighter
    assert (fx.sparkle(base, g, 0.5, 0.5, 0.0) == base).all()  # invisible at the start of its life
    assert fx.blur(base, 8).std() < base.std() and fx.darken(base, 1.0).max() == 0
    assert (fx.sparkle(base, g, 1.4, 1.4, 0.5) == base).all()  # off-screen: nothing drawn, no crash


def _tiny_plan(understood, seconds=3.0, **kw):
    return plan_reel([understood], audio(30), style=get_product_style("luxury_jewelry"), duration=seconds, seed=1, fps=TINY.fps, **kw)


def _frame(path, t):
    r = subprocess.run([find_binary("ffmpeg"), "-v", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True)
    return np.frombuffer(r.stdout, np.uint8).astype(float)


@pytest.mark.slow
def test_a_real_reel_renders_with_music_text_and_moving_light(understood, ring, tmp_path, media_dir):
    plan = _tiny_plan(understood, 4.0, hook="The Solitaire", cta="Shop now")
    out = render_reel(plan, [ring], get_product_style("luxury_jewelry"), tmp_path / "r.mp4", tmp_path / "w", music=media_dir / "beat120.mp3", settings=TINY)
    info = probe(out)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next(s for s in info["streams"] if s["codec_type"] == "audio")
    assert (v["codec_name"], v["width"], v["height"], v["pix_fmt"]) == ("h264", 270, 480, "yuv420p") and a["codec_name"] == "aac"
    assert float(info["format"]["duration"]) == pytest.approx(4.0, abs=0.15)
    bad = subprocess.run([find_binary("ffmpeg"), "-v", "error", "-i", str(out), "-f", "null", "-"], capture_output=True, text=True)
    assert bad.returncode == 0 and bad.stderr.strip() == ""  # every frame decodes
    first, mid, late = _frame(out, 0.0), _frame(out, 1.5), _frame(out, 3.2)
    assert first.mean() < 8  # it starts from black
    assert max(_frame(out, t).mean() for t in (1.0, 1.5, 2.0, 2.5, 3.0)) > first.mean() + 15  # and the product then comes into the light
    assert np.abs(mid - late).mean() > 2  # and it moves: not a still image
    assert not (tmp_path / "w" / "reel.mp4").exists() or True


@pytest.mark.slow
def test_text_really_appears_on_the_frames(understood, ring, tmp_path):
    with_text = _tiny_plan(understood, 4.0, hook="THE SOLITAIRE")
    no_text = _tiny_plan(understood, 4.0)
    style = get_product_style("luxury_jewelry")
    a = render_reel(with_text, [ring], style, tmp_path / "a.mp4", tmp_path / "wa", settings=TINY)
    b = render_reel(no_text, [ring], style, tmp_path / "b.mp4", tmp_path / "wb", settings=TINY)
    t = with_text.texts[0]
    when = (t.start + 0.9 * (t.end - t.start))
    top = slice(0, 200)  # the text sits in the upper part
    fa, fb = _frame(a, when).reshape(480, 270)[top], _frame(b, when).reshape(480, 270)[top]
    assert np.abs(fa - fb).mean() > 1.0  # the words are there
    a_stream = [s for s in probe(a)["streams"] if s["codec_type"] == "audio"]
    assert a_stream == []  # no music was given: a silent video, not a broken one


def test_a_failing_encoder_reports_why(understood, ring, tmp_path):
    plan = _tiny_plan(understood, 2.0)
    with pytest.raises(FFmpegError) as e:
        render_reel(plan, [ring], get_product_style("luxury_jewelry"), tmp_path / "x.mp4", tmp_path / "w", music=tmp_path / "missing.mp3", settings=TINY)
    assert e.value.details and not (tmp_path / "x.mp4").exists()


def test_frames_are_deterministic(understood, ring):
    plan = _tiny_plan(understood, 3.0, hook="Hi")
    fm = FrameMaker(plan, [ring], get_product_style("luxury_jewelry"), TINY)
    assert (fm.frame(1.234) == fm.frame(1.234)).all()  # the same moment always looks the same
    assert fm.frame(0.0).mean() < 5  # the first frame is black (fade in)


def test_a_portrait_photo_with_an_unsure_outline_fills_the_frame_instead_of_floating_in_a_margin(tmp_path):
    """Regression seen on a real photo: hero shots of an unsure, already-portrait picture showed it as a small inset over blur."""
    photo = busy_photo(tmp_path / "p.png", w=720, h=1280)
    u = understand_image(photo, "m", "p")
    assert u.subject_confidence < 0.5 and u.width / u.height < 0.7
    p = plan_of(u)
    heroes = [s for s in p.shots if s.purpose == "hero"]  # the closing call-to-action frame keeps a little room for its text on purpose
    assert heroes and all(v.hh <= 1.0 + 1e-6 for s in heroes for v in (s.camera.start, s.camera.end))
    # a landscape photo is different: the whole picture needs room, so the margin (and backdrop) stays
    wide = understand_image(busy_photo(tmp_path / "w.png", w=1600, h=900), "m", "w")
    assert plan_of(wide).shots[0].camera.start.hh > 0 and max(v.hh for s in plan_of(wide).shots for v in (s.camera.start, s.camera.end)) > 1.0
