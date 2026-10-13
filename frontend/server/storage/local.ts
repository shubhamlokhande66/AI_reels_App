import "server-only";
import fs from "node:fs";
import path from "node:path";
import { settings } from "@/server/core/config";
import { AppError } from "@/server/core/errors";

/** Files on the local disk under one root (STORAGE_PATH), addressed by keys like `projects/<id>/input/x.mp4`: the same
 * layout as the Python backend (backend/app/storage/local.py). A key can never point outside the root. */

const root = settings.storagePath;

export function localPath(key: string): string {
  const p = path.resolve(root, key.replace(/^[/\\]+/, ""));
  if (p !== root && !p.startsWith(root + path.sep)) throw new AppError("Invalid storage key.", { code: "INVALID_STORAGE_KEY" });
  return p;
}

export const exists = (key: string) => fs.existsSync(localPath(key));

export function ensureProject(projectId: string) {
  for (const sub of ["input", "output", "analysis"]) fs.mkdirSync(localPath(`projects/${projectId}/${sub}`), { recursive: true });
}

export function deletePrefix(prefix: string) {
  fs.rmSync(localPath(prefix), { recursive: true, force: true });
}
