import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { SentResponse } from "./session.guard";
import { AppError, errorBody } from "../server/core/errors";

/** Native routes answer errors in the app's model ({ error: { code, message, details } }), like src/routes do. */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    if (e instanceof SentResponse) return;
    const res = host.switchToHttp().getResponse();
    if (e instanceof AppError) return res.status(e.status).json(errorBody(e.code, e.message, e.details));
    console.error("Unhandled error", e);
    return res.status(500).json(errorBody("INTERNAL_ERROR", "An unexpected error occurred."));
  }
}
