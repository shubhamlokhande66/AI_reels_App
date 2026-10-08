"""A story plan: the characters (described once, so every picture shows them the same) and the scenes."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.models.base import CamelModel

Shot = Literal["wide", "medium", "close"]
Mood = Literal["calm", "devotional", "joyful", "tense", "sad", "epic", "mysterious"]
PictureSource = Literal["library", "public_domain", "free_ai", "paid_ai", "upload"]


class ArtStyle(CamelModel):
    id: str
    name: str
    prompt: str  # how every picture of this style is described to an image model
    paintings: bool = False  # public-domain paintings fit this style (e.g. Raja Ravi Varma)


ART_STYLES: dict[str, ArtStyle] = {
    s.id: s
    for s in (
        ArtStyle(id="ravi_varma", name="Classical Indian painting", paintings=True,
                 prompt="classical Indian oil painting in the style of Raja Ravi Varma, rich deep colours, soft golden light, fine detail"),
        ArtStyle(id="temple_mural", name="Temple mural",
                 prompt="traditional Kerala temple mural painting, ornate, earthy reds and greens, bold outlines, divine and decorative"),
        ArtStyle(id="cinematic", name="Cinematic realistic",
                 prompt="cinematic realistic film still, dramatic lighting, epic scale, shallow depth of field, rich colour grade"),
        ArtStyle(id="comic", name="Indian comic book",
                 prompt="classic Indian comic book illustration, clean ink lines, flat bright colours, expressive faces"),
        ArtStyle(id="anime", name="Anime",
                 prompt="detailed anime illustration, vibrant colours, soft cel shading, beautiful background art"),
        ArtStyle(id="watercolor", name="Storybook watercolour",
                 prompt="soft storybook watercolour illustration, gentle colours, paper texture, warm and calm"),
    )
}  # fmt: skip


class Character(CamelModel):
    name: str = Field(max_length=60)
    look: str = Field(default="", max_length=300)  # the same words go into every picture this character is in


class StoryScene(CamelModel):
    id: str
    narration: str = Field(max_length=600)  # what the voice says (the story's language)
    visual: str = Field(max_length=700)  # what the picture shows (English: image models understand it best)
    keywords: list[str] = []  # English names / things in the picture (picture search and the shared library)
    characters: list[str] = []  # names from the story's characters shown in this picture
    shot: Shot = "medium"
    mood: Mood = "calm"
    # the picture found for this scene
    image_key: str | None = None
    source: PictureSource | None = None
    credit: str = ""
    library_id: str | None = None
    seen: list[str] = []  # pictures already shown for this scene ("Another picture" skips them)


class StoryPlan(CamelModel):
    title: str = Field(max_length=120)
    language: str = "hi"
    art_style: str = "ravi_varma"
    music_mood: str = "devotional"
    characters: list[Character] = []
    scenes: list[StoryScene] = []
    post_copy: dict | None = None  # title / description / hashtags
    planned_by: str = "ai"  # "ai" | "simple" (the AI was not available: scenes split by sentence; it can be retried)
    source_text: str = ""  # the story as written (to plan it again)
    seconds: int = 60
