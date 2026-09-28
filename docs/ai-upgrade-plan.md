# AI upgrade: findings and plan

Source: `adv_requirement.md`. Baseline before any change: backend `pytest -m "not slow"` → 455 passed.

## 1. Current architecture findings

* **One provider seam already exists.** Every AI call goes through `AIProvider` (`app/ai/provider.py`) via
  `get_provider()`. Only `OllamaProvider` is real; OpenAI/Anthropic/Gemini are stubs raising `AI_PROVIDER_NOT_IMPLEMENTED`.
* **Provider logic leaks outside the provider.**
  * `api/ai_settings.py` is Ollama-only (`_ollama()` raises for any other provider); the Settings UI only renders when
    `provider === "ollama"`.
  * `jobs/pipeline.py::understand_clips` records `get_settings().ollama_model` as the vision model and breaks on
    Ollama-specific error codes (`OLLAMA_UNAVAILABLE`, `OLLAMA_MODEL_MISSING`).
  * `ai/model_choice.py` stores only an Ollama model name.
* **No structured output.** All callers use `chat_json()` = "please return JSON" + a tolerant parser. Each caller then
  hand-sanitises a raw `dict` (`clip_selector`, `copywriter`, `director`, `understanding`, `script`, `revise/actions`,
  `services/library`, `api/templates`). Validation is good but ad hoc; there is no repair retry.
* **AI calls per generate (AI on):** 1 vision call per clip (cached) + style (Auto only) + story *or* order + post copy
  = up to 3 text calls. Story and order are alternatives, never both. Post copy could be merged into a director call.
* **AI receives too little, not too much.** The order prompt sends 7 numbers per clip; the model never sees beats,
  energy, drops or usable windows, so it can only give a soft order hint. Rules do all shot decisions.
* **Effects/transitions:** transitions have a registry (`video/transitions.py`, 58 entries). Effects are a hard-coded
  tuple (`EFFECT_TYPES`) + `zoom_expression()` in `video/cutter.py`; no pan effects. The revise prompt hard-codes a
  partial effect/transition list.
* **Colour:** one fixed `grade_filter` string per editing style; no presets, not selectable per Reel.
* **Text:** video Reels have captions (ASS) and step labels only. Product Reels already have animated text layers
  (`product/textass.py`) that can be reused.
* **Observability/cost:** none. No usage log, no budget, no latency record.
* **Privacy:** local-only today; there is no LOCAL/CLOUD indicator.
* **Deterministic work already cached:** clip analysis, audio analysis, semantic understanding (per clip JSON under
  `analysis/`). Good; reuse as is.

## 2. Files that need modification

| File | Change |
| --- | --- |
| `app/ai/provider.py` | Extended interface, normalized result/errors, factory with task routing (keeps `get_provider`, `set_provider`, `parse_json_object`) |
| `app/ai/ollama.py` | Implement `generate()`; normalized errors; keep `installed_models()` |
| `app/core/config.py`, `.env.example` | Provider, model, fallback, retry, vision, budget, pricing settings |
| `app/ai/model_choice.py` | Becomes the saved AI config (provider, models, fallback, budgets); old file still read |
| `app/api/ai_settings.py` | Provider-agnostic settings, test, usage endpoints (old endpoints kept) |
| `app/api/system.py` | Health reports provider + LOCAL/CLOUD |
| `app/ai/clip_selector.py`, `copywriter.py`, `director.py`, `understanding.py`, `script.py`, `revise/actions.py`, `services/library.py`, `api/templates.py` | Use Pydantic structured output |
| `app/jobs/pipeline.py` | Director stage, provider-agnostic vision, overlay/grade rendering hooks |
| `app/models/timeline.py` | Optional `color_grade`, `overlays`, `ai` fields (all defaulted: old projects load unchanged) |
| `app/video/cutter.py`, `renderer.py` | Effect registry lookup, pan effects, grade presets |
| `app/quality/checker.py`, `director/review.py` | New QC checks + deterministic fixes |
| `app/product/director.py` | Accept an optional validated AI concept |
| Frontend `app/settings/page.tsx`, `lib/api.ts`, `types/api.ts`, project page | Settings UI, usage, AI badge |

## 3. Files that should NOT be modified (beyond trivial hooks)

`video/composer.py` (final join/encode), `video/timeline.py` (rule engine stays the fallback), `video/timeline_ops.py`
(EDL ops), `services/timeline_service.py` (history/undo), `audio/*`, `video/analyzer.py`, `captions/*`, `voice/*`,
`storage/*`, `jobs/manager.py`, `product/render.py`, `product/effects.py`. Analysis stays deterministic.

## 4. Provider abstraction changes

* `AIProvider` keeps `chat`, `chat_json`, `chat_turns`, `chat_images`, `health` (unchanged signatures) and adds
  `generate()` → `AIResult` (normalized: parsed, text, provider, model, latency_ms, tokens, cached tokens, cost,
  request id, warnings), `generate_structured(model_cls)`, `generate_vision_structured(model_cls, images)`,
  `list_models()`, `get_model_info()`, `estimate_cost()`, `is_local`.
* Normalized errors: `AIProviderError(kind=timeout|rate_limit|auth|quota|temporary|unavailable|model_missing|
  bad_request|invalid_response|refusal|not_configured)`; `retryable` and `fallback_ok` derive from `kind`.
  It subclasses `AIUnavailable`, so every existing `except AppError` keeps working.
* `ManagedProvider` wraps the real provider: budget check → retry policy → optional fallback → usage log.
* `get_provider(task=None)`: task → text/vision kind → per-task override → `AI_TEXT_PROVIDER` / `AI_VISION_PROVIDER` → `AI_PROVIDER`.
* Structured output: one helper validates every result with Pydantic, does one repair call, then raises
  `AIResponseError` so callers fall back.

## 5. OpenAI implementation plan

Official `openai` SDK (3.x), Responses API. Schema-constrained output via `text.format = json_schema` (strict schema
generated from the Pydantic model), falling back to `json_object` if a schema cannot be made strict. Separate
`OPENAI_TEXT_MODEL` / `OPENAI_VISION_MODEL`; no model names in code. Images as `input_image` data URLs with
`VISION_DETAIL_LEVEL`. SDK retries off (our policy retries). Error mapping: timeout, rate limit vs
`insufficient_quota`, auth/permission, 5xx, connection, 404 model, 400 bad request, refusal output, incomplete output.

## 6. Gemini implementation plan

Official `google-genai` SDK. `generate_content` with `system_instruction`, `response_mime_type=application/json` and
`response_json_schema`; images as `Part.from_bytes`; multi-turn as `Content(role=user|model)`. Separate text and
vision models. Error mapping from `errors.ClientError`/`ServerError` codes + safety finish reasons / prompt block → refusal.
Usage from `usage_metadata`.

## 7. Settings UI changes

Provider dropdown (Ollama/OpenAI/Gemini) with configured/not-configured state (keys never sent: only "key set: yes/no"),
text + vision model dropdowns (listed from the provider when possible, free text otherwise), fallback on/off +
fallback provider, Test connection (latency, result, error), budget (daily/monthly, override), usage (today/week/month:
calls, ok, failed, cost, per provider), LOCAL AI / CLOUD AI badge. The old Ollama model picker remains for Ollama.

## 8. AI Director upgrade plan

New stage `directing` (AI on + footage understood or brief given):
1. Build compact context: per clip (id alias, name, duration, quality/brightness/sharpness/motion/shake, scene cuts,
   usable windows, objects, tags, category, mood, hook/ending suitability) + music (duration, BPM, strong-beat and
   onset timestamps within the chosen window, energy curve downsampled, drops, sections) + style catalogue + effect,
   transition, grade and caption-style registries (dynamic) + brief, brand, CTA, captions, language.
2. One structured call → `ReelDirectorPlan` (style, grade, shots with purpose/effect/transition/crop/focus/speed/
   beat alignment/caption, overlays, music start/volume, CTA, post copy). Story + shot direction + hook/text + copy
   are generated together (one call instead of three).
3. Deterministic validator maps it onto the EDL: aliases → real clip ids, source window clamped into usable windows,
   cuts snapped to beats, total duration forced to the requested length, unsupported effects/transitions mapped to
   the closest supported one, speeds clamped, transitions fitted, overlays clamped into the timeline and safe area.
4. If the plan is unusable → the existing rule engine builds the timeline (today's behaviour) with a warning.
Result cached per (inputs hash) so regenerating does not call the model again.

## 9. Timeline/EDL changes (all optional, defaulted)

`Timeline.color_grade: str | None` (preset id), `Timeline.overlays: list[TextOverlay]` (text, start, end, role,
position, animation), `Timeline.ai: dict | None` (provider, model, used for which tasks). `Segment.effect` gains
`pan_left|pan_right|pan_up|pan_down` through the new `EffectRegistry`. Old documents validate unchanged.

## 10. Cost/usage tracking plan

`ai_usage` Mongo collection (pymongo, written from worker threads; failures never break AI). Fields: provider,
model, task, project_id, timestamp, latency_ms, ok, tokens in/out/cached, cost, fallback_used, error_code.
Prices are configuration (`AI_MODEL_PRICES` JSON, USD per 1M tokens) converted with `AI_CURRENCY`/`AI_CURRENCY_RATE`;
an unpriced model shows "not priced", never a guess. `DAILY_AI_BUDGET` / `MONTHLY_AI_BUDGET` block non-essential tasks
when exceeded unless the override is on; rule-based generation always works.

## 11. Test plan

Contract tests run against all three providers with mocked transports (Ollama via `httpx.MockTransport`, OpenAI and
Gemini via fake SDK clients): chat, chat_json, chat_images, health, structured output, invalid output + repair,
timeout, error normalization. Plus: factory routing, fallback rules (operational only, disabled = no switch), budget,
usage log, director validator (bad clip ids, negative/overlong times, unknown effects, duration mismatch), grade and
effect registries, overlay ASS, QC checks. Live tests in `tests/integration/` marked `live`, skipped without keys.

## 12. Migration plan

No data migration. New Timeline fields default to empty. `AI_PROVIDER` unset → `ollama` (current behaviour).
The saved `settings/ai_model.json` is still honoured as the Ollama model. Old endpoints (`/api/ai/models`,
`/api/ai/model`, `/api/ai/models/test`) keep their shapes. Rollout order: providers → settings/usage → structured
callers → registries/grade/overlays → director → vision → QC → product → revise.
