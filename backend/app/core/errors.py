"""Uniform error model. Every API error is {"error": {"code", "message", "details"}}."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 400
    code = "BAD_REQUEST"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: Any = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details


class NotFoundError(AppError):
    status_code = 404
    code = "NOT_FOUND"


class ConflictError(AppError):
    status_code = 409
    code = "CONFLICT"


class ValidationFailed(AppError):
    status_code = 422
    code = "VALIDATION_ERROR"


class PayloadTooLarge(AppError):
    status_code = 413
    code = "FILE_TOO_LARGE"


class UnsupportedMedia(AppError):
    status_code = 415
    code = "UNSUPPORTED_MEDIA"


class InsufficientStorage(AppError):
    status_code = 507
    code = "INSUFFICIENT_DISK_SPACE"


class RateLimited(AppError):
    status_code = 429
    code = "RATE_LIMITED"


# Errors raised by the media pipeline (run inside job threads, surfaced via job.error).
class MediaError(AppError):
    code = "MEDIA_ERROR"


class CorruptedMedia(MediaError):
    code = "CORRUPTED_MEDIA"


class FFmpegError(MediaError):
    status_code = 500
    code = "FFMPEG_RENDER_FAILED"


class RenderTimeout(MediaError):
    status_code = 504
    code = "RENDER_TIMEOUT"


class AIUnavailable(AppError):
    status_code = 503
    code = "AI_UNAVAILABLE"


class JobCancelled(AppError):
    """Raised inside a running job's worker thread when the user cancels it (checked at every progress tick)."""

    status_code = 409
    code = "JOB_CANCELLED"


def error_body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content=error_body(exc.code, exc.message, exc.details)
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg", "")} for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_body("VALIDATION_ERROR", "Request validation failed.", details),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return JSONResponse(
            status_code=exc.status_code, content=error_body(code, str(exc.detail))
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=error_body("INTERNAL_ERROR", "An unexpected error occurred."),
        )
