"""AI direction for Product Reels: validated into the deterministic director; the renderer is untouched."""

from __future__ import annotations

import json

import pytest

from app.ai.product_director import ProductDirection, build_request, small_photos
from app.ai.provider import set_provider
from app.product.director import apply_direction, plan_reel
from app.product.styles import get_product_style
from app.product.understand import understand_image
from tests.test_ai import FakeProvider
from tests.test_product import audio, ring_photo


@pytest.fixture(scope="module")
def ring(tmp_path_factory):
    d = tmp_path_factory.mktemp("ring_ai")
    path = ring_photo(d / "ring.png")
    return path, understand_image(path, "m1", "ring.png")


@pytest.fixture(autouse=True)
def _reset():
    yield
    set_provider(None)


def direction(**kw):
    base = {"product": "gold ring", "reason": "light reveals the stone", "sparkle": "more", "light": "less",
            "phases": [{"purpose": "hook", "share": 0.1, "camera": "pull_out"}, {"purpose": "reveal", "share": 0.2, "camera": "push_in"},
                       {"purpose": "hero", "share": 0.3, "camera": "drift"}, {"purpose": "macro", "share": 0.25, "camera": "tilt_up"},
                       {"purpose": "cta", "share": 0.15, "camera": "hold"}],
            "hook": "Made to be seen forever and ever", "tagline": "Pure gold", "cta": "Shop now", "hook_animation": "type_on"}  # fmt: skip
    base.update(kw)
    return ProductDirection.model_validate(base)


def test_the_direction_is_validated(ring):
    _, u = ring
    style = get_product_style("luxury_jewelry")
    d = apply_direction(direction(), style, 15.0, [u], hook="", tagline="", cta="")
    assert [p for p, _, _ in d.phases] == ["hook", "reveal", "hero", "macro", "cta"]
    assert sum(sh for _, sh, _ in d.phases) == pytest.approx(1.0, abs=1e-3)
    assert d.cameras["macro"] == "tilt_up" and d.hook == "Made to be seen forever and" and d.animations["hook"] == "type_on"
    assert d.style.sparkle_max <= 8 and d.style.sparkle_max > style.sparkle_max and d.style.light_sweeps == style.light_sweeps - 1


def test_bad_directions_fall_back_safely(ring):
    _, u = ring
    style = get_product_style("clean_product")
    d = apply_direction(direction(phases=[{"purpose": "explosion", "share": 3}, {"purpose": "hero", "share": 0.5}], cta="Buy",
                                  sparkle="lots", hook_animation="spin"), style, 10.0, [u], hook="", tagline="", cta="")  # fmt: skip
    assert d.phases[0][0] == "hook" and len(d.phases) >= 3 and "explosion" not in [p for p, _, _ in d.phases]
    assert "hook" not in d.animations and d.style.sparkle_max == style.sparkle_max
    assert any("explosion" in n for n in d.notes)


def test_the_users_own_texts_always_win(ring):
    _, u = ring
    d = apply_direction(direction(), get_product_style("luxury_jewelry"), 15.0, [u], hook="Handmade in Jaipur", tagline="", cta="Visit us")
    assert d.hook == "Handmade in Jaipur" and d.cta == "Visit us" and d.tagline == "Pure gold"


def test_a_directed_plan_follows_the_ai_and_still_passes_every_quality_rule(ring):
    _, u = ring
    d = apply_direction(direction(), get_product_style("luxury_jewelry"), 15.0, [u], hook="", tagline="", cta="")
    plan = plan_reel([u], audio(), style=d.style, duration=15.0, hook=d.hook, tagline=d.tagline, cta=d.cta, phases=d.phases,
                     cameras=d.cameras, text_animations=d.animations)  # fmt: skip
    purposes = []
    for s in plan.shots:
        if not purposes or purposes[-1] != s.purpose:
            purposes.append(s.purpose)
    assert purposes == ["hook", "reveal", "hero", "macro", "cta"]
    assert plan.shots[0].camera.type == "pull_out" and plan.shots[-1].end == pytest.approx(15.0)
    assert {t.role: t.animation_in for t in plan.texts}["hook"] == "type_on"
    failed = [c.name for c in plan.quality if not c.ok]  # checked against the directed story
    assert not failed, failed


def test_the_ai_sees_small_photos_and_measured_facts(ring):
    path, u = ring
    photos = small_photos([path], 512)
    assert len(photos) == 1 and photos[0][:2] == b"\xff\xd8"
    import cv2
    import numpy as np

    assert max(cv2.imdecode(np.frombuffer(photos[0], np.uint8), cv2.IMREAD_COLOR).shape[:2]) <= 512
    facts = build_request([u], 15.0, "Luxury jewellery", brief="launch", language="en", hook="", tagline="", cta="Shop", bpm=120)
    assert facts["photos"][0]["real_highlights"] > 0 and facts["reel"]["cta_given"] == "Shop"


async def test_product_reels_use_the_ai_director_end_to_end_plan(client, ring):
    path, _ = ring
    class VisionFake(FakeProvider):
        def chat_images(self, system, user, images_b64, *, temperature=0.1):
            self.calls.append((system, user))
            return json.loads(self.replies[0])

    fake = VisionFake([json.dumps(direction().model_dump())])
    set_provider(fake)
    pid = (await client.post("/api/projects", json={"name": "Ring", "settings": {"reelType": "product", "duration": 12, "ai": True}})).json()["id"]
    r = await client.post(f"/api/projects/{pid}/images", files=[("files", ("ring.png", path.read_bytes(), "image/png"))])
    assert r.status_code == 201, r.text
    plan = (await client.post(f"/api/projects/{pid}/product/plan", json={})).json()
    assert plan["concept"]["ai"].startswith("AI director") and len(fake.calls) == 1
    assert plan["postCopy"] is None or isinstance(plan["postCopy"], dict)
    assert plan["shots"][0]["purpose"] == "hook" and any(t["role"] == "hook" for t in plan["texts"])
    plan2 = (await client.post(f"/api/projects/{pid}/product/plan", json={})).json()
    assert len(fake.calls) == 1 and plan2["concept"]["ai"] == plan["concept"]["ai"]  # cached: no second call


# ---------------------------------------------------------------------- transitions
def test_the_ai_chooses_the_transition_into_each_part(ring):
    _, u = ring
    phases = [{"purpose": "hook", "share": 0.15}, {"purpose": "reveal", "share": 0.25, "transition": "dissolve"},
              {"purpose": "hero", "share": 0.3, "transition": "dip_to_black"}, {"purpose": "detail", "share": 0.2, "transition": "portal"},
              {"purpose": "cta", "share": 0.1, "transition": "light"}]  # fmt: skip
    d = apply_direction(direction(phases=phases), get_product_style("luxury_jewelry"), 12.0, [u], hook="", tagline="", cta="")
    assert d.transitions == {"reveal": "dissolve", "hero": "dip_to_black", "cta": "light"} and any("portal" in n for n in d.notes)
    plan = plan_reel([u], audio(), style=d.style, duration=12.0, phases=d.phases, transitions=d.transitions)
    first_of = {}
    for s in plan.shots:
        first_of.setdefault(s.purpose, s)
    assert first_of["reveal"].transition_in.type == "dissolve" and first_of["hero"].transition_in.type == "dip_to_black"
    assert all(a.transition_in.type != b.transition_in.type or a.transition_in.type in ("cut", "match") for a, b in zip(plan.shots, plan.shots[1:]))


def _frames_around(ring, kind):
    import cv2

    from app.product.models import ShotTransition
    from app.product.render import FrameMaker, RenderSettings

    path, u = ring
    style = get_product_style("luxury_jewelry")
    plan = plan_reel([u], audio(), style=style, duration=10.0)
    k = next(i for i, s in enumerate(plan.shots) if i > 0 and s.length > 0.6 and plan.shots[i - 1].length > 0.6)
    plan.shots[k].transition_in = ShotTransition(type=kind, duration=0.5)
    fm = FrameMaker(plan, [path], style, RenderSettings(width=270, height=480, fps=24, crf=30, preset="ultrafast"))
    cut = plan.shots[k].start
    return cut, lambda t: cv2.cvtColor(fm.frame(t), cv2.COLOR_BGR2GRAY)


def test_transitions_are_strongest_at_the_cut_on_both_sides(ring):
    import cv2

    cut, gray = _frames_around(ring, "blur")
    sharp = lambda t: cv2.Laplacian(gray(t), cv2.CV_64F).var()  # noqa: E731
    assert sharp(cut + 0.01) < 0.2 * sharp(cut + 0.3)  # the incoming shot starts blurred ...
    assert sharp(cut + 0.1) < sharp(cut + 0.2) <= 1.02 * sharp(cut + 0.3)  # ... and sharpens steadily (no pop at the end)


def test_dissolve_and_dip_to_black(ring):
    import numpy as np

    cut, gray = _frames_around(ring, "dissolve")
    jump = float(np.abs(gray(cut - 1 / 48).astype(float) - gray(cut + 1 / 48).astype(float)).mean())
    assert jump < 8.0  # a blend, not a hard cut
    cut, gray = _frames_around(ring, "dip_to_black")
    assert gray(cut - 0.01).mean() < 3 and gray(cut + 0.01).mean() < 3 and gray(cut + 0.3).mean() > 15
