"""Looks for product Reels. Pure data, like the editing styles: the director and the renderer read it."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.errors import ValidationFailed


@dataclass(frozen=True)
class ProductStyle:
    id: str
    name: str
    description: str
    # how lively the edit is
    pace: float = 1.0  # >1 = shorter shots
    push: float = 0.16  # how much a push-in / pull-out moves (fraction of the view)
    sway_deg: float = 0.9  # micro sway on hero shots (a degree or so; not a 3D orbit)
    # effects (each is capped: "never overload")
    sparkle_max: int = 6
    light_sweeps: int = 2
    glow: float = 0.3  # bloom on hero/payoff shots (0 = none)
    light_leaks: int = 1
    dust: bool = False
    flash_on_drops: bool = False
    whip: bool = False
    vignette: float = 0.28
    contrast: float = 1.06
    saturation: float = 1.04
    # how transitions are chosen (weights for the alternatives used when a table pick would repeat)
    alt_transitions: tuple[str, ...] = ("blur", "match", "cut")
    # text
    font: str = "Georgia"
    text_color: str = "#F6E7C8"
    text_outline: str = "#000000"
    bold: bool = True


_REGISTRY: dict[str, ProductStyle] = {}


def _reg(s: ProductStyle) -> ProductStyle:
    _REGISTRY[s.id] = s
    return s


LUXURY = _reg(ProductStyle(
    id="luxury_jewelry", name="Luxury jewellery",
    description="Slow, elegant camera; light sweeps across the metal; sparkles only on real reflections; gold text.",
    pace=0.9, push=0.14, sway_deg=1.0, sparkle_max=7, light_sweeps=2, glow=0.35, light_leaks=1, dust=False, flash_on_drops=False,
    whip=False, vignette=0.32, contrast=1.08, saturation=1.05, alt_transitions=("blur", "match", "cut"),
    font="Georgia", text_color="#F6E7C8",
))  # fmt: skip
CLEAN = _reg(ProductStyle(
    id="clean_product", name="Clean product",
    description="Crisp and modern: precise pushes, match cuts and zooms, one light sweep, no glitter.",
    pace=1.0, push=0.18, sway_deg=0.6, sparkle_max=0, light_sweeps=1, glow=0.12, light_leaks=0, dust=False, flash_on_drops=False,
    whip=False, vignette=0.18, contrast=1.05, saturation=1.02, alt_transitions=("match", "cut", "blur"),
    font="Segoe UI", text_color="#FFFFFF", bold=True,
))  # fmt: skip
ENERGETIC = _reg(ProductStyle(
    id="energetic", name="Energetic",
    description="Fast and punchy: whips, flashes on the drops, light leaks and dust, bold text.",
    pace=1.35, push=0.22, sway_deg=1.2, sparkle_max=5, light_sweeps=2, glow=0.25, light_leaks=2, dust=True, flash_on_drops=True,
    whip=True, vignette=0.22, contrast=1.1, saturation=1.1, alt_transitions=("whip_left", "zoom", "match"),
    font="Arial", text_color="#FFFFFF", bold=True,
))  # fmt: skip

DEFAULT_STYLE = LUXURY.id


def list_product_styles() -> list[ProductStyle]:
    return list(_REGISTRY.values())


def get_product_style(style_id: str) -> ProductStyle:
    try:
        return _REGISTRY[style_id]
    except KeyError:
        raise ValidationFailed(f"Unknown product style '{style_id}'.", code="UNKNOWN_PRODUCT_STYLE", details={"available": sorted(_REGISTRY)}) from None
