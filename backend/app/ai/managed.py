"""The provider the app actually talks to: budget check -> retries -> optional fallback -> usage log.

* Retries only for rate limits and temporary/connection errors, with a short backoff. Never for bad requests,
  refusals or invalid answers.
* Fallback only when it is enabled, the fallback is a different provider, and the failure was *operational*
  (timeout, quota, outage, auth/config ...). A refusal or a bad request never switches provider.
* When a budget is used up, non-essential tasks are blocked (unless the user turned the override on); rule-based
  generation keeps working because every caller treats an AI failure as "use the deterministic path".
"""

from __future__ import annotations

import logging
import time
from typing import Any

from app.ai.provider import AIProvider
from app.ai.tasks import get_task
from app.ai.types import AIProviderError, AIRequest, AIResult
from app.ai.usage import budget_state, record_call

log = logging.getLogger(__name__)
BACKOFF = (1.0, 3.0, 6.0, 10.0, 15.0)
MAX_WAIT = 65.0  # never wait longer than about a minute for one retry


class ManagedProvider(AIProvider):
    def __init__(self, primary: AIProvider, task: str = "general", fallback: AIProvider | None = None, max_retries: int = 2,
                 config: Any = None, sleep=time.sleep) -> None:  # fmt: skip
        self.primary = primary
        self.fallback = fallback if fallback is not None and fallback.name != primary.name else None
        self.task = task
        self.max_retries = max_retries
        self.config = config
        self._sleep = sleep
        self.last_result: AIResult | None = None

    # the managed provider looks like its primary
    @property
    def name(self) -> str:  # type: ignore[override]
        return self.primary.name

    @property
    def model(self) -> str:  # type: ignore[override]
        return self.primary.model

    @property
    def vision_model(self) -> str:  # type: ignore[override]
        return self.primary.vision_model

    @property
    def is_local(self) -> bool:  # type: ignore[override]
        return self.primary.is_local

    def health(self) -> dict[str, Any]:
        return self.primary.health()

    def list_models(self) -> list[dict[str, Any]]:
        return self.primary.list_models()

    def get_model_info(self) -> dict[str, Any]:
        info = self.primary.get_model_info()
        info["fallback"] = self.fallback.name if self.fallback else None
        return info

    # ------------------------------------------------------------------
    def _check_budget(self, task: str) -> None:
        if self.config is None or get_task(task).essential or self.config.budget_override:
            return
        state = budget_state(self.config)
        if state["exceeded"]:
            raise AIProviderError(f"AI was skipped: {state['reason']} (turn on the budget override in Settings to continue).",
                                  kind="budget", provider=self.primary.name, code="AI_BUDGET_EXCEEDED")  # fmt: skip

    def _attempt(self, provider: AIProvider, req: AIRequest, fallback_used: bool) -> AIResult:
        tries = 0
        while True:
            started = time.monotonic()
            try:
                res = provider.generate(req)
            except AIProviderError as exc:
                record_call(provider=provider.name, model=provider.model_for(req), task=req.task, ok=False,
                            latency_ms=int((time.monotonic() - started) * 1000), fallback_used=fallback_used, error_code=exc.code)  # fmt: skip
                # a stalled cloud call is worth one more try; a local model that timed out already took minutes
                again = exc.retryable or (exc.kind == "timeout" and not provider.is_local and tries == 0)
                if again and tries < self.max_retries:
                    delay = BACKOFF[min(tries, len(BACKOFF) - 1)]
                    if exc.retry_after:  # the provider said how long its per-minute limit needs: wait exactly that
                        delay = min(max(exc.retry_after + 0.5, 1.0), MAX_WAIT)
                    log.info("%s %s failed (%s); retrying in %.0fs", provider.name, req.task, exc.kind, delay)
                    tries += 1
                    self._sleep(delay)
                    continue
                raise
            res.fallback_used = fallback_used
            res.task = req.task
            record_call(provider=res.provider, model=res.model, task=req.task, ok=True, latency_ms=res.latency_ms,
                        input_tokens=res.input_tokens, output_tokens=res.output_tokens, cached_tokens=res.cached_tokens,
                        cost=res.cost, fallback_used=fallback_used, request_id=res.request_id)  # fmt: skip
            return res

    def generate(self, req: AIRequest) -> AIResult:
        if req.task == "general":
            req.task = self.task
        self._check_budget(req.task)
        try:
            res = self._attempt(self.primary, req, fallback_used=False)
        except AIProviderError as exc:
            if self.fallback is None or not exc.fallback_ok:
                raise
            log.warning("AI provider %s failed for %s (%s: %s); using fallback %s", self.primary.name, req.task, exc.kind,
                        exc.code, self.fallback.name)  # fmt: skip
            try:
                res = self._attempt(self.fallback, req, fallback_used=True)
            except AIProviderError as fb_exc:
                raise AIProviderError(f"{exc.message} The fallback ({self.fallback.name}) also failed: {fb_exc.message}",
                                      kind=exc.kind, provider=self.primary.name, code=exc.code) from fb_exc  # fmt: skip
            res.warnings.append(f"{self.primary.name} was unavailable ({exc.kind}); {self.fallback.name} answered instead.")
        self.last_result = res
        return res
