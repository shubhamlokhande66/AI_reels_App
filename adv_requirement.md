You are working on my existing AI Reel Maker project.

IMPORTANT:
Do NOT rebuild the application from scratch.
Do NOT remove existing working functionality.
Do NOT replace the existing EDL/Timeline architecture.
Do NOT directly let an AI model execute FFmpeg commands.
Preserve backward compatibility with the current project.

I want you to upgrade the existing application into a more professional, AI-directed Reel creation system.

CURRENT ARCHITECTURE

* Frontend: Next.js 16, React 19, TypeScript, Tailwind 4, TanStack Query
* Backend: Python FastAPI
* Database: MongoDB
* Storage: local filesystem through StorageBackend
* Video: FFmpeg + FFprobe
* Video analysis: OpenCV
* Audio analysis: librosa/scipy/numpy
* Captions: faster-whisper
* Voice: Windows SAPI
* Current AI: Ollama, default gemma3:4b
* Current backend size: ~14,000 lines
* Existing AI abstraction: backend/app/ai/provider.py
* Existing EDL/Timeline is the single source of truth
* Existing JobManager/background-thread pipeline must remain
* Existing REST API must remain backward compatible

CURRENT AI PROVIDER REQUIREMENT

Create a proper multi-provider AI architecture:

AI_PROVIDER = ollama | openai | gemini

The user must be able to select the active provider from Settings.

Settings must support:

AI Provider:
[ Ollama ▼ ]

Available:

* Ollama
* OpenAI
* Gemini

Provider-specific configuration:

OLLAMA:

* OLLAMA_BASE_URL
* OLLAMA_MODEL

OPENAI:

* OPENAI_API_KEY
* OPENAI_TEXT_MODEL
* OPENAI_VISION_MODEL

GEMINI:

* GEMINI_API_KEY
* GEMINI_TEXT_MODEL
* GEMINI_VISION_MODEL

Do not expose API keys to the browser.
Keys must remain backend-side/environment variables.

The Settings page should show:

Provider
Model
Connection status
Test AI button
Available models if supported
Last test result
Latency
Error message if unavailable

The UI must never assume Ollama exists.

ARCHITECTURE

Implement:

AIProvider
|
+-- OllamaProvider
+-- OpenAIProvider
+-- GeminiProvider

All application AI calls must continue using AIProvider.

No feature should directly import the OpenAI or Gemini SDK.

Create a provider factory/service such as:

get_ai_provider()

The provider should be selected from configuration.

The rest of the application should remain provider-agnostic.

COMMON INTERFACE

Preserve/extend the existing interface:

chat()
chat_json()
chat_turns()
chat_images()
health()

If useful, add:

generate_structured()
generate_vision_structured()
estimate_cost()
get_model_info()

Use typed Pydantic models for AI outputs.

STRUCTURED OUTPUT

This is very important.

Do not rely on "please return JSON" prompts alone.

Use structured/schema-constrained output whenever the provider supports it.

OpenAI:
Use the current OpenAI API structured-output capability / JSON schema support.

Gemini:
Use Gemini structured-output / JSON schema capability.

Ollama:
Continue using JSON mode plus Pydantic validation and retry/fallback.

Every AI result must pass Pydantic validation before entering the application.

If validation fails:

1. Attempt one controlled repair/retry.
2. If still invalid, fall back safely.
3. Never allow malformed AI output to corrupt the Timeline.

AI should never be allowed to invent arbitrary Timeline fields.

AI-DIRECTED VIDEO EDITING

This is the biggest feature upgrade.

Currently the system uses rules for clip scoring and timeline building while AI mostly provides style/order hints.

Upgrade this so AI can become a CREATIVE DIRECTOR.

The AI should receive compact structured information, NOT entire raw videos.

For each clip provide:

* clip_id
* filename
* duration
* quality score
* brightness
* sharpness
* motion
* shake
* scene cuts
* usable windows
* detected objects
* semantic tags
* category
* mood
* hook suitability
* ending suitability
* keyframes

Use up to several representative low-resolution keyframes rather than uploading entire videos unnecessarily.

The AI should also receive:

* Reel duration
* BPM
* beat timestamps
* strong beats
* onsets
* energy curve
* drops
* music sections
* selected style
* user prompt
* brand information
* CTA
* caption preferences
* language

AI OUTPUT

Create a validated ReelDirectorPlan.

Example conceptual structure:

{
"style": "luxury",
"reason": "...",
"shots": [
{
"clip_id": "...",
"source_start": 0.0,
"source_end": 2.4,
"timeline_start": 0.0,
"timeline_end": 2.4,
"purpose": "hook",
"effect": "slow_zoom_in",
"transition": "fade",
"crop": "auto",
"focus_x": 0.5,
"focus_y": 0.5,
"speed": 1.0,
"beat_alignment": "strong",
"caption": "...",
"caption_style": "luxury"
}
],
"music": {
"start": 12.4,
"volume": 0.8
},
"cta": "...",
"warnings": []
}

IMPORTANT:
The AI must NOT output FFmpeg commands.

The AI outputs a high-level validated director plan.

Then convert:

AI Director Plan
↓
Timeline/EDL operations
↓
Existing renderer
↓
FFmpeg

The existing EDL remains the single source of truth.

TIMELINE SAFETY

Add a deterministic validation layer between AI and Timeline.

Validate:

* source_start < source_end
* timeline_start < timeline_end
* no invalid clip IDs
* no negative timestamps
* duration limits
* transitions fit available duration
* effects are supported
* crop values are valid
* speed is within supported range
* captions stay within timeline
* total timeline duration matches requested Reel duration

If AI generates an unsupported effect, automatically map it to the closest supported effect.

Do not crash the render because of one bad AI instruction.

AI ROLE SEPARATION

Do not make one giant AI prompt responsible for everything.

Use specialized tasks:

1. Clip Understanding
2. Style Selection
3. Story Planning
4. Shot Selection
5. Shot Direction
6. Hook Generation
7. Text Overlay Generation
8. Caption Generation
9. Post Copy
10. Natural Language Revision

However, optimize AI calls.

Do NOT call the model unnecessarily.

Cache deterministic analysis.

Cache semantic clip understanding.

Cache repeated requests.

Reuse existing analysis JSON.

Do not ask the AI to calculate BPM, beat timestamps, brightness, sharpness, motion, etc.

Those remain deterministic local processing.

AI should reason over those results.

AI COST OPTIMIZATION

Implement an AI call policy.

For each request determine:

* Does this require AI?
* Can cached AI output be reused?
* Can a smaller/cheaper model be used?
* Can multiple related tasks be combined into one structured call?
* Does vision actually need to be called?

Do not make separate AI calls for information that can be generated together.

For example, Story + Shot Direction + Hook/Text can potentially be generated in one structured director call.

Use deterministic code wherever possible.

PROVIDER SELECTION

Settings should allow:

Provider:

* Ollama
* OpenAI
* Gemini

The selected provider applies globally by default.

Also allow optional per-task configuration:

Creative Director: OpenAI
Vision: Gemini
Copywriter: Gemini
Chat: OpenAI
Local/private tasks: Ollama

If per-task configuration is too invasive for the current UI, implement global provider first but design the backend so per-task provider overrides can be added later.

Recommended configuration concept:

AI_PROVIDER=openai

Optional:

AI_TEXT_PROVIDER=openai
AI_VISION_PROVIDER=gemini

If these are empty, fall back to AI_PROVIDER.

This gives flexibility without breaking the current architecture.

FAILOVER

Add optional provider fallback.

Example:

Primary:
OpenAI

Fallback:
Gemini

If OpenAI is unavailable, timeout occurs, quota is exceeded, or provider returns an operational error:

* retry according to safe retry policy
* optionally fallback to Gemini
* log provider failure
* continue only if the fallback produces valid output

Never silently switch providers if the user has disabled fallback.

Settings should contain:

Enable AI fallback: ON/OFF

Primary provider:
OpenAI

Fallback provider:
Gemini

Do NOT fallback for invalid user requests or safety refusals; only operational/provider failures should trigger fallback.

VISION OPTIMIZATION

Current system sends up to 3 small keyframes per clip.

Improve this intelligently.

Do not blindly increase image count.

Use:

* representative first/middle/last frames
* scene-change frames when available
* high-motion/high-quality frames
* product-centered frame when available

For product reels, prioritize frames showing the product clearly.

Avoid sending duplicate or nearly identical frames.

Allow configurable:

VISION_MAX_FRAMES_PER_CLIP
VISION_MAX_IMAGE_SIZE
VISION_DETAIL_LEVEL

PRODUCT REEL DIRECTOR

Preserve the existing Product Reel Director.

Improve it so AI can generate:

Hook
Reveal
Hero
Detail
CTA

with:

* camera movement
* zoom
* pan
* light sweep
* sparkle
* text animation
* timing
* transition
* product focus

But keep all actual rendering deterministic inside the existing renderer.

NAMORA / LUXURY MODE

Keep the existing Luxury Jewellery style.

Optimize it for premium jewellery/product reels.

Preferred structure:

0–2 sec:
Strong visual hook

2–5 sec:
Product reveal

5–10 sec:
Hero product shot

10–15 sec:
Detail/macro shot

15–20 sec:
Lifestyle/use context if available

Final:
CTA

Do not hardcode these timings.
AI should adapt them according to Reel duration and available assets.

TEXT / HOOK OVERLAYS

Current video reels have a gap where automatic hook/text overlays are not fully directed by AI.

Add AI-generated optional overlays.

Examples:

* Hook
* Product benefit
* Product name
* Short emotional statement
* CTA

Respect:

* safe areas
* readable contrast
* brand typography
* maximum words per screen
* minimum display duration

Do not overload the screen.

EFFECT SYSTEM

Improve the existing effect registry so the AI can choose only supported effects.

Create a typed EffectRegistry.

Examples:

zoom_in
zoom_out
zoom_pulse
pan_left
pan_right
pan_up
pan_down
punch
fade
crossfade
flash
speed_ramp

The AI should receive the supported effect list dynamically.

Never hardcode unsupported effects into the AI prompt.

This prevents the model from requesting an effect that FFmpeg cannot execute.

COLOUR GRADING

Add a deterministic colour-grade preset system.

Examples:

luxury
cinematic
warm
clean
high_contrast
soft
natural

The AI selects the preset.

The renderer performs the actual grading.

Do not ask the AI to calculate raw FFmpeg filter strings.

QUALITY CONTROL

Improve current QC.

Current QC checks:

* black frames
* frozen frames
* silence
* clipping
* A/V duration

Keep those.

Add:

* text outside safe area
* caption overlap
* excessive shot duration
* excessive rapid cuts
* repeated clip detection
* duplicate frames
* unsupported effect
* invalid crop
* audio loudness
* abrupt audio start/end

When possible:

QC issue
↓
deterministic Auto Fix
↓
re-render only when necessary

Do not automatically regenerate the entire Reel with AI for deterministic problems.

NATURAL LANGUAGE REVISIONS

Preserve:

POST /api/{project}/revise

Examples:

"make it more luxury"
"remove the first shot"
"make cuts faster"
"make the product appear earlier"
"less text"
"more energetic"
"change the CTA"
"make the reel calmer"

Convert natural language into validated Timeline operations.

Use phrase rules first.

Use AI only when the rule system cannot interpret the request.

Require confirmation for destructive changes.

OPENAI IMPLEMENTATION

Implement a production-ready OpenAIProvider.

Do not hardcode model names throughout the application.

Configuration should control models.

Use structured outputs wherever supported.

Separate:

text model
vision model

Handle:

timeout
rate limit
authentication failure
quota/billing failure
temporary provider error
invalid response
refusal

Return normalized provider errors so the rest of the application does not care whether the error came from OpenAI or Gemini.

GEMINI IMPLEMENTATION

Implement a production-ready GeminiProvider.

Use the official Google GenAI SDK.

Support:

chat
structured JSON
vision
multi-turn where required
health check

Separate:

text model
vision model

Do not let Gemini-specific response structures leak outside the provider.

Normalize Gemini responses into the same internal format as OpenAI and Ollama.

NORMALIZED RESPONSE

Create an internal normalized response object containing, where available:

* parsed data
* raw text
* provider
* model
* latency_ms
* input token count
* output token count
* cached token count if available
* estimated cost
* request ID
* warnings

This allows the application to display AI usage information.

AI OBSERVABILITY

Add an AI usage log.

Store:

* provider
* model
* task
* project_id
* timestamp
* latency
* success/failure
* token usage when available
* estimated cost
* fallback used
* error code

Do NOT store API keys.

Add an AI usage section in Settings.

Show:

Today
This week
This month

* AI calls
* successful calls
* failed calls
* estimated cost
* provider breakdown

Add optional budget controls:

DAILY_AI_BUDGET
MONTHLY_AI_BUDGET

If budget is exceeded:

* block non-essential AI calls
* allow user to override if desired
* deterministic reel generation should still work

PRIVACY

The current app is local-first.

Maintain that behavior.

When using Ollama:
No media leaves the machine.

When using OpenAI/Gemini:
Only the minimum required metadata/keyframes should leave the machine.

Do not upload entire videos unless explicitly required by a future feature.

Show a clear indicator in the UI:

LOCAL AI
or
CLOUD AI

when appropriate.

API KEY SECURITY

Never send:

OPENAI_API_KEY
GEMINI_API_KEY
OLLAMA credentials

to the browser.

Never expose them in logs.

Never include them in error responses.

Never commit them to source control.

TESTING

Add provider-independent tests.

Every provider must pass the same contract tests:

* chat
* chat_json
* chat_images
* health
* structured output
* invalid output handling
* timeout
* provider error normalization

Mock provider responses in tests.

Do not require live API keys for the test suite.

Add integration tests separately for real provider tests.

BACKWARD COMPATIBILITY

Existing endpoints must continue working.

Existing Timeline/EDL format must remain compatible.

Existing projects must open.

Existing Ollama users must continue working.

If AI_PROVIDER is not configured:

Use current behavior.

If OpenAI is configured but unavailable:

Show a clear error and allow fallback if enabled.

If Gemini is configured but unavailable:

Show a clear error and allow fallback if enabled.

UI CHANGES

Update Settings.

Add:

AI Provider
Text Model
Vision Model
Fallback Provider
Enable Fallback
AI Budget
AI Usage
Test Connection

Show provider status.

Example:

AI Provider
[ OpenAI ▼ ]

Text Model
[ configured model ▼ ]

Vision Model
[ configured model ▼ ]

Fallback
[ Gemini ▼ ]

[✓] Enable fallback

[ Test Connection ]

Today:
12 calls
Estimated cost: ₹X

Also show:

AI: OpenAI
or
AI: Gemini
or
AI: Ollama

inside the Reel project UI when AI is used.

ARCHITECTURAL OPTIMIZATION

Before making changes, inspect the existing code.

Identify duplicated provider logic.

Identify unnecessary AI calls.

Identify synchronous operations that can safely be cached.

Identify places where the AI receives too much information.

Identify places where deterministic code can replace AI.

Do not rewrite stable modules unnecessarily.

Prefer small, isolated changes.

Recommended architecture:

Frontend
↓
FastAPI
↓
AI Orchestrator
↓
Provider Factory
↓
┌──────────────┬──────────────┬──────────────┐
│   Ollama     │   OpenAI     │    Gemini    │
└──────────────┴──────────────┴──────────────┘
↓
Normalized AI Result
↓
Pydantic Validation
↓
Director Plan
↓
Timeline/EDL
↓
Existing FFmpeg Renderer

IMPORTANT FINAL RULE

AI is the creative director.

Python/OpenCV/librosa are the analysis engines.

Timeline/EDL is the source of truth.

FFmpeg is the execution/rendering engine.

Do not blur these responsibilities.

DELIVERABLE

First inspect the current repository and produce:

1. Current architecture findings
2. Files that need modification
3. Files that should NOT be modified
4. Provider abstraction changes
5. OpenAI implementation plan
6. Gemini implementation plan
7. Settings UI changes
8. AI Director upgrade plan
9. Timeline/EDL changes
10. Cost/usage tracking plan
11. Test plan
12. Migration plan

Then implement the changes incrementally.

After implementation, provide:

* files changed
* files added
* environment variables required
* commands to install dependencies
* commands to run
* tests added
* tests passed
* known limitations

Do not claim a feature is implemented unless it actually exists in the code.
