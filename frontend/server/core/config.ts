import "server-only";
import fs from "node:fs";
import path from "node:path";

/** Settings, from the same `.env` at the repo root that the Python backend read (backend/app/core/config.py), so
 * both servers agree while the migration runs. Next.js itself only loads `frontend/.env*`; the root file is read
 * here once. Real environment variables win over the file. */

export const REPO_ROOT = path.resolve(process.cwd(), "..");

function readDotEnv(file: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trimStart().startsWith("#")) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "");
      out[m[1]] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = readDotEnv(path.join(REPO_ROOT, ".env"));
const env = (key: string, fallback = ""): string => process.env[key] ?? fileEnv[key] ?? fallback;
const num = (key: string, fallback: number) => {
  const v = Number(env(key, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
};
const bool = (key: string, fallback: boolean) => {
  const v = env(key, "").toLowerCase();
  return v === "" ? fallback : ["1", "true", "yes", "on"].includes(v);
};

export const settings = {
  mongodbUri: env("MONGODB_URI", "mongodb://localhost:27017/ai_reel_maker"),
  mongodbDb: env("MONGODB_DB", "ai_reel_maker"),
  /** relative paths are from the repo root (where the data has always been) */
  storagePath: path.resolve(REPO_ROOT, env("STORAGE_PATH", "./storage")),
  maxVideoSizeMb: num("MAX_VIDEO_SIZE_MB", 500),
  maxAudioSizeMb: num("MAX_AUDIO_SIZE_MB", 50),
  ffmpegBin: env("FFMPEG_BIN", ""),
  ffprobeBin: env("FFPROBE_BIN", ""),
  authEnabled: bool("AUTH_ENABLED", false),
  /** the Python backend, for every endpoint not moved to Next.js yet (see docs/MIGRATION.md) */
  pythonUrl: env("PYTHON_BACKEND_URL", "http://127.0.0.1:8000"),
};
