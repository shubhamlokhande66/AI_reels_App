import "server-only";
import { z } from "zod";
import { ValidationFailed } from "./errors";

/** A JSON request body checked against a schema; a bad one is the 422 Pydantic gave ({loc, msg} details). An empty
 * body counts as {} (FastAPI's optional payloads). */
export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body"], msg: "JSON decode error" }] });
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ValidationFailed("Request validation failed.", { details: r.error.issues.map((i) => ({ loc: ["body", ...i.path.map(String)], msg: i.message })) });
  return r.data;
}

export const flag = (req: Request, name: string) => ["1", "true", "yes", "on"].includes((new URL(req.url).searchParams.get(name) ?? "").toLowerCase());
