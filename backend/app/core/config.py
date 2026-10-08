"""Application settings, loaded from environment variables / .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    node_env: str = "development"
    mongodb_uri: str = "mongodb://localhost:27017/ai_reel_maker"
    mongodb_db: str = "ai_reel_maker"
    cors_origins: str = "http://localhost:3100,http://127.0.0.1:3100,http://localhost:3000,http://127.0.0.1:3000"
    # Phone mode: also accept pages opened from another device on the same private network (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
    # Off by default: the app has no login, so anyone on that network could use it while this is on.
    cors_allow_lan: bool = False

    storage_path: Path = REPO_ROOT / "storage"

    # Uploads
    max_video_size_mb: int = 500
    max_audio_size_mb: int = 50
    max_videos_per_project: int = 0  # 0 = unlimited
    max_image_size_mb: int = 40
    max_images_per_project: int = 12
    min_free_disk_mb: int = 1024

    # Output
    output_width: int = Field(default=1080, ge=240, le=4320)
    output_height: int = Field(default=1920, ge=240, le=7680)
    output_fps: int = Field(default=30, ge=15, le=60)

    # FFmpeg. Leave empty to auto-detect from PATH.
    ffmpeg_bin: str = ""
    ffprobe_bin: str = ""
    render_timeout_seconds: int = 900
    ffmpeg_threads: int = 0  # 0 = let FFmpeg decide
    hw_accel: str = "auto"  # auto | off | h264_nvenc | h264_qsv | h264_amf | h264_videotoolbox (CPU fallback)

    # Captions (faster-whisper). Model is downloaded on first use.
    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_language: str = ""  # empty = auto-detect

    # Jobs
    max_concurrent_jobs: int = 1

    # AI. The provider can also be chosen in Settings (saved in storage/settings/ai_config.json, which wins over .env).
    ai_provider: str = "ollama"  # ollama | openai | gemini | claude
    ai_text_provider: str = ""  # optional: text tasks on another provider ("" = ai_provider)
    ai_vision_provider: str = ""  # optional: vision tasks on another provider ("" = ai_provider)
    ai_fallback_enabled: bool = False  # on a provider failure (timeout, quota, outage ...) try ai_fallback_provider
    ai_fallback_provider: str = ""
    ai_max_retries: int = Field(default=2, ge=0, le=5)  # retries of rate-limit / temporary errors (never of bad requests)
    # Reviewer + self-correction (director/self_correct.py): below this overall score a final Reel is corrected and
    # rendered again, at most review_max_iterations reviews in all (the first render counts).
    review_threshold: int = Field(default=70, ge=0, le=100)
    # Production: the key that unlocks admin-only parts (AI settings, diagnostics). Empty = everyone is admin (local use).
    admin_key: SecretStr = SecretStr("")
    # Production accounts (core/auth.py): sign-in required, each user's data in their own database.
    auth_enabled: bool = False
    # Billing (services/credits.py, api/billing.py): credits are counted only when this and accounts are on.
    billing_enabled: bool = False
    # Your business, shown on the legal and contact pages (Razorpay checks that these exist)
    business_name: str = "Reel Maison"
    support_email: str = ""
    support_phone: str = ""
    business_address: str = ""
    legal_updated: str = "8 October 2026"
    # Email (password reset): any SMTP service (Gmail app password, Brevo, Zoho, Amazon SES ...). Empty = links go to the log.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""  # e.g. "Reel Maison <no-reply@your-domain>"
    smtp_ssl: bool = False  # true for port 465 (SSL); false = STARTTLS on 587
    razorpay_key_id: str = ""  # Razorpay dashboard > Settings > API keys (rzp_test_... while testing)
    razorpay_key_secret: SecretStr = SecretStr("")
    razorpay_webhook_secret: SecretStr = SecretStr("")  # Razorpay dashboard > Webhooks (payment.captured, order.paid)
    # Auto-delete (services/retention.py; the admin can change it on the Admin page): uploaded clips / songs go this many
    # hours after a project was last used, the whole project (Reels included) after the second number.
    retention_enabled: bool = False
    keep_uploads_hours: int = 2
    keep_projects_hours: int = 24
    secret_key: SecretStr = SecretStr("")  # signs the session cookies: a long random string, keep it secret
    cookie_secure: bool = False  # true behind HTTPS (the session cookie is then only sent over HTTPS)
    review_max_iterations: int = Field(default=3, ge=1, le=3)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = ""
    ollama_vision_model: str = ""  # "" = ollama_model
    openai_api_key: SecretStr = SecretStr("")
    openai_text_model: str = ""
    openai_vision_model: str = ""  # "" = openai_text_model
    openai_base_url: str = ""  # "" = the official API
    openai_reasoning_effort: str = ""  # optional, for reasoning models: minimal | low | medium | high
    gemini_api_key: SecretStr = SecretStr("")
    gemini_tts_model: str = "gemini-3.8-flash-tts"  # natural AI voices (voice/gemini.py)
    openai_tts_model: str = "gpt-4o-mini-tts"  # OpenAI voices (voice/openai_voice.py); "tts-1" is cheaper, without style instructions
    # Story -> Reel pictures (story/images.py): the free AI pictures (Cloudflare Workers AI, FLUX.1 schnell) ...
    cloudflare_account_id: str = ""
    cloudflare_api_token: SecretStr = SecretStr("")
    # ... and paid pictures, only when the admin switches them on: "" (off) | "gemini" | "openai"
    story_paid_images: str = ""
    contact_email: str = ""  # sent to Wikimedia with picture searches (their API policy asks clients for a contact)
    gemini_image_model: str = "gemini-3.1-flash-image"
    openai_image_model: str = "gpt-image-2"
    # Live trends (trends/feed.py): a licensed / official trend-data feed. Empty = the built-in presets only.
    trend_feed_url: str = ""
    trend_feed_key: SecretStr = SecretStr("")
    # Publishing (publish/): the platforms' official APIs. Empty = that platform is not connected.
    instagram_user_id: str = ""  # Instagram professional account id (Meta Graph API)
    instagram_access_token: SecretStr = SecretStr("")
    tiktok_access_token: SecretStr = SecretStr("")  # TikTok Content Posting API (an approved app)
    youtube_client_id: str = ""  # YouTube Data API (OAuth client)
    youtube_client_secret: SecretStr = SecretStr("")
    youtube_refresh_token: SecretStr = SecretStr("")
    public_base_url: str = ""  # https://your-domain: platforms fetch the video from a signed link on it
    gemini_text_model: str = ""
    gemini_vision_model: str = ""  # "" = gemini_text_model
    anthropic_api_key: SecretStr = SecretStr("")
    claude_text_model: str = "claude-opus-5-5"
    claude_vision_model: str = ""  # "" = claude_text_model (Claude reads images with the same model)
    claude_effort: str = "medium"  # low | medium | high | xhigh | max: how deeply Claude thinks (cost vs quality)
    claude_timeout_seconds: float = 180.0  # a whole-Reel director plan with thinking can take a couple of minutes
    ai_timeout_seconds: float = 300.0  # local models on CPU can need minutes for one answer, more so on a cold model load
    cloud_ai_timeout_seconds: float = 60.0  # OpenAI / Gemini (a stalled call is retried once)
    vision_timeout_seconds: float = 420.0  # the first vision call loads the model into memory
    # Vision: what is sent per clip (fewer, smaller, distinct frames = faster and cheaper)
    vision_max_frames_per_clip: int = Field(default=4, ge=1, le=8)
    vision_max_image_size: int = Field(default=384, ge=128, le=1024)  # longest side in pixels
    vision_detail_level: str = "low"  # low | high | auto (OpenAI image detail; others ignore it)
    # Cost + budget. Prices are yours to set (USD per 1M tokens); an unpriced model shows "not priced".
    ai_model_prices: str = ""  # JSON, e.g. {"model-name": {"input": 0.4, "output": 1.6, "cached": 0.1}}
    ai_currency: str = "USD"
    ai_currency_rate: float = Field(default=1.0, gt=0)  # 1 USD in ai_currency
    daily_ai_budget: float = Field(default=0.0, ge=0)  # in ai_currency; 0 = no limit
    monthly_ai_budget: float = Field(default=0.0, ge=0)

    # Song library: folders whose audio files are imported automatically (";"-separated)
    song_import_folders: str = ""

    # Rate limiting (requests per minute per client) for expensive endpoints
    rate_limit_per_minute: int = 60

    @field_validator("storage_path")
    @classmethod
    def _absolute_storage(cls, v: Path) -> Path:
        """Relative paths (like the ./storage in .env) are relative to the repo, not the cwd."""
        return v if v.is_absolute() else (REPO_ROOT / v).resolve()

    @property
    def cors_origin_regex(self) -> str | None:
        return PRIVATE_NETWORK_ORIGIN if self.cors_allow_lan else None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


# http(s)://<private IPv4>[:port] only. No public addresses, no hostnames.
PRIVATE_NETWORK_ORIGIN = (
    r"^https?://(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d{1,5})?$"
)


@lru_cache
def get_settings() -> Settings:
    return Settings()
