
/** The uniform error model, the same as the Python backend's (backend/app/core/errors.py): every API error is
 * `{"error": {"code", "message", "details"}}` with a fitting HTTP status. */

export class AppError extends Error {
  status = 400;
  code = "BAD_REQUEST";
  details: unknown;
  constructor(message: string, opts: { code?: string; details?: unknown; status?: number } = {}) {
    super(message);
    if (opts.code) this.code = opts.code;
    if (opts.status) this.status = opts.status;
    this.details = opts.details ?? null;
  }
}

const kind = (status: number, code: string) =>
  class extends AppError {
    constructor(message: string, opts: { code?: string; details?: unknown } = {}) {
      super(message, { status, code: opts.code ?? code, details: opts.details });
    }
  };

export const NotFoundError = kind(404, "NOT_FOUND");
export const ConflictError = kind(409, "CONFLICT");
export const ValidationFailed = kind(422, "VALIDATION_ERROR");
export const PayloadTooLarge = kind(413, "FILE_TOO_LARGE");
export const UnsupportedMedia = kind(415, "UNSUPPORTED_MEDIA");
export const RateLimited = kind(429, "RATE_LIMITED");
export const AIUnavailable = kind(503, "AI_UNAVAILABLE");
export const InsufficientStorage = kind(507, "INSUFFICIENT_DISK_SPACE");
// the media pipeline's errors (raised inside jobs, surfaced as job.error)
export const CorruptedMedia = kind(400, "CORRUPTED_MEDIA");
export const FFmpegError = kind(500, "FFMPEG_RENDER_FAILED");
export const RenderTimeout = kind(504, "RENDER_TIMEOUT");
/** Raised inside a running job when the user cancels it (checked at every progress tick). */
export const JobCancelled = kind(409, "JOB_CANCELLED");

export function errorBody(code: string, message: string, details: unknown = null) {
  return { error: { code, message, details } };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) return Response.json(errorBody(e.code, e.message, e.details), { status: e.status });
  console.error("Unhandled error", e);
  return Response.json(errorBody("INTERNAL_ERROR", "An unexpected error occurred."), { status: 500 });
}
