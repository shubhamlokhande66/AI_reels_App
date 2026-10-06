"""Request/response schemas for the REST API."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, field_validator

from app.models.base import CamelModel

ProjectStatus = Literal["draft", "processing", "completed", "failed"]
CaptionStyle = Literal["minimal", "bold", "karaoke", "highlight", "luxury"]
Pace = Literal["auto", "calm", "balanced", "fast"]  # auto = the AI director decides from the instructions and music
Sequence = Literal["mixed", "steps"]
OrderMode = Literal["auto", "manual"]
AudioMode = Literal["music", "voice_music", "voice", "original", "none"]
Language = Literal["en", "hi", "mr", "hinglish"]

MIN_DURATION = 5
MAX_DURATION = 600  # 10 minutes


class CustomStyleParams(CamelModel):
    """User-tunable parameters for the 'custom' style (all optional)."""

    cut_beats_high: int | None = Field(default=None, ge=1, le=16)
    cut_beats_low: int | None = Field(default=None, ge=1, le=16)
    min_segment: float | None = Field(default=None, ge=0.2, le=10)
    max_segment: float | None = Field(default=None, ge=0.5, le=15)
    transitions: dict[str, float] | None = None
    transition_duration: float | None = Field(default=None, ge=0.05, le=1.5)
    effects: dict[str, float] | None = None
    slow_motion_chance: float | None = Field(default=None, ge=0, le=1)


class ProjectSettings(CamelModel):
    duration: int = Field(default=15, ge=MIN_DURATION, le=MAX_DURATION)
    audio_start: float | None = Field(default=None, ge=0, le=36000)  # where in the song the Reel begins; None = automatic
    style: str = "fast_trending"
    pace: Pace = "balanced"  # how quickly the edit cuts: calm = long shots, fast = every beat
    teaser: bool = True  # step-by-step Reels: open with a short look at the finished dish (the last clip)
    step_labels: bool = True  # step-by-step Reels: "Step 1", "Step 2"... on screen
    order_mode: OrderMode = "auto"  # step-by-step Reels: "auto" guesses the order from file names / what clips show; "manual" keeps your clip list order exactly
    sequence: Sequence = "mixed"  # mixed = best moments in any order; steps = every clip once, in the order it happened (recipes, tutorials)
    export_preset: str = "instagram_reel"  # see video/presets.py
    audio_mode: AudioMode = "music"  # music | voice_music | voice | original | none
    reel_type: Literal["edit", "product"] = "edit"  # edit = cut the user's video clips; product = a Reel directed from product photos
    product_style: str = "luxury_jewelry"
    hook_text: str = Field(default="", max_length=80)  # on-screen text, all optional (kept minimal)
    tagline_text: str = Field(default="", max_length=80)
    cta_text: str = Field(default="", max_length=80)
    loop: bool = False  # product Reels: make the last frame return to the first
    language: Language = "en"
    voice_profile_id: str | None = None
    brand_id: str | None = None
    brief: str = Field(default="", max_length=1000)  # what the Reel is about (drives clip relevance, hooks, scripts)
    captions: bool = False
    caption_style: CaptionStyle = "minimal"
    ai: bool = False
    ai_director: bool = True  # with AI on: the AI plans every shot (validated); off = AI only assists the rule-based editor
    auto_review: bool = True  # the Quality Reviewer scores the edit and revises it (up to 2 rounds) before rendering
    sound_effects: bool = False  # whooshes on moving transitions, a riser + impact on the drop, pops under text
    delete_media_after_render: bool = False  # privacy: delete the uploaded clips/song once a final Reel is rendered
    trend_id: str | None = None
    reference: str = Field(default="auto", max_length=40)  # edit like a learned trend: "auto" = the AI picks, "none", or its id
    custom_style: CustomStyleParams | None = None


_NAME_CLEAN = re.compile(r"[\x00-\x1f\x7f]")


def _clean_name(v: str) -> str:
    v = _NAME_CLEAN.sub("", v).strip()
    if not v:
        raise ValueError("Project name must not be empty.")
    return v


class ProjectCreate(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    settings: ProjectSettings = ProjectSettings()

    _v_name = field_validator("name")(_clean_name)


class ProjectUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    duration: int | None = Field(default=None, ge=MIN_DURATION, le=MAX_DURATION)
    audio_start: float | None = Field(default=None, ge=0, le=36000)
    style: str | None = None
    pace: Pace | None = None
    sequence: Sequence | None = None
    teaser: bool | None = None
    step_labels: bool | None = None
    order_mode: OrderMode | None = None
    export_preset: str | None = None
    brief: str | None = Field(default=None, max_length=1000)
    audio_mode: AudioMode | None = None
    product_style: str | None = None
    hook_text: str | None = Field(default=None, max_length=80)
    tagline_text: str | None = Field(default=None, max_length=80)
    cta_text: str | None = Field(default=None, max_length=80)
    loop: bool | None = None
    language: Language | None = None
    voice_profile_id: str | None = None
    brand_id: str | None = None
    captions: bool | None = None
    caption_style: CaptionStyle | None = None
    ai: bool | None = None
    ai_director: bool | None = None
    auto_review: bool | None = None
    sound_effects: bool | None = None
    trend_id: str | None = None
    reference: str | None = Field(default=None, max_length=40)
    delete_media_after_render: bool | None = None
    custom_style: CustomStyleParams | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean_name(v) if v is not None else v


class MediaOut(CamelModel):
    id: str
    kind: Literal["video", "audio", "image"]
    name: str
    size: int
    mime_type: str
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    analysis: dict[str, Any] | None = None  # clip quality summary once analysed
    url: str
    thumbnail_url: str | None = None
    purged: bool = False  # the file was deleted for privacy after rendering (the Reels are kept)


class RenderingOut(CamelModel):
    id: str
    project_id: str
    style: str
    duration: float
    width: int
    height: int
    size: int
    label: str = ""
    kind: Literal["final", "preview"] = "final"
    timeline_version: int = 1
    created_at: datetime
    url: str
    download_url: str
    post_copy: dict[str, Any] | None = None  # AI title/description/hashtags when AI assist was on
    performance: dict[str, Any] | None = None  # numbers the user typed in from the platform (never fetched)


class JobStage(CamelModel):
    name: str
    label: str
    status: Literal["pending", "running", "completed", "failed"] = "pending"
    progress: int = 0


class JobOut(CamelModel):
    id: str
    project_id: str
    type: Literal["analyze", "generate", "render", "variations", "product"]
    status: Literal["queued", "processing", "completed", "failed", "cancelled"]
    progress: int
    stage: str
    stages: list[JobStage] = []
    error: dict[str, Any] | None = None
    rendering_id: str | None = None
    created_at: datetime
    updated_at: datetime


class ProjectOut(CamelModel):
    id: str
    name: str
    status: ProjectStatus
    settings: ProjectSettings
    videos: list[MediaOut] = []
    images: list[MediaOut] = []  # product Reels: the photos, in the order the director sees them
    reel_plan: dict[str, Any] | None = None  # the director's plan (shots, music map, quality checks) for the latest edited Reel
    product_plan: dict[str, Any] | None = None  # the director's shot list for the latest product Reel
    audio: MediaOut | None = None
    analysis: dict[str, Any] | None = None
    timeline: dict[str, Any] | None = None
    timeline_version: int = 0
    preview: RenderingOut | None = None
    output: RenderingOut | None = None
    latest_job: JobOut | None = None
    error: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class ProjectSummary(CamelModel):
    id: str
    name: str
    status: ProjectStatus
    style: str
    duration: int
    video_count: int
    thumbnail_url: str | None = None
    output_url: str | None = None
    created_at: datetime
    updated_at: datetime


class GenerateRequest(CamelModel):
    """Optional overrides for one generation (used by Regenerate / Change style / Another version)."""

    style: str | None = None
    pace: Pace | None = None
    sequence: Sequence | None = None
    teaser: bool | None = None
    step_labels: bool | None = None
    order_mode: OrderMode | None = None
    export_preset: str | None = None
    brief: str | None = Field(default=None, max_length=1000)
    audio_mode: AudioMode | None = None
    language: Language | None = None
    duration: int | None = Field(default=None, ge=MIN_DURATION, le=MAX_DURATION)
    audio_start: float | None = Field(default=None, ge=0, le=36000)  # begin the Reel at this point of the song
    audio_auto: bool = False  # true = forget a chosen start and let the app pick the best part
    captions: bool | None = None
    caption_style: CaptionStyle | None = None
    ai: bool | None = None
    ai_director: bool | None = None
    auto_review: bool | None = None
    sound_effects: bool | None = None
    trend_id: str | None = None
    reference: str | None = Field(default=None, max_length=40)
    seed: int | None = None  # change to get a different edit from the same inputs
    label: str | None = Field(default=None, max_length=60)


class VideoOrder(CamelModel):
    ids: list[str] = Field(min_length=1, max_length=100)
