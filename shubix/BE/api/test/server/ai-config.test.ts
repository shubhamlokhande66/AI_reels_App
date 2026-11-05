// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** What the admin saves is what runs, whatever the server's env says, until the admin changes it. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-config-"));
let C: typeof import("../../src/server/ai/config");
let S: typeof import("../../src/server/ai/settingsApi");

beforeAll(async () => {
  process.env.STORAGE_PATH = dir;
  process.env.AI_PROVIDER = "ollama";
  process.env.AI_TEXT_PROVIDER = "openai";
  process.env.AI_VISION_PROVIDER = "gemini";
  process.env.OPENAI_TEXT_MODEL = "env-openai";
  process.env.CLAUDE_TEXT_MODEL = "env-claude";
  C = await import("../../src/server/ai/config");
  S = await import("../../src/server/ai/settingsApi");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const saved = (o: Record<string, unknown>) => C.SavedAIConfig.parse(o);

describe("the AI model the admin chose", () => {
  it("nothing saved: the env decides", () => {
    const cfg = C.effective(saved({}));
    expect(C.providerFor(cfg, "general")).toBe("openai");
    expect(cfg.models.openai[0]).toBe("env-openai");
  });

  it("a saved provider beats the env's text and vision providers", () => {
    const cfg = C.effective(saved({ provider: "claude", textProvider: "", visionProvider: "", models: { claude: { text: "admin-model", vision: null } } }));
    expect(cfg.textProvider).toBe("claude");
    expect(cfg.visionProvider).toBe("claude");
    expect(C.providerFor(cfg, "general")).toBe("claude");
    expect(C.providerFor(cfg, "clip_understanding")).toBe("claude");
    expect(cfg.models.claude[0]).toBe("admin-model");
  });

  it("a separate vision provider the admin chose is kept", () => {
    const cfg = C.effective(saved({ provider: "claude", visionProvider: "openai" }));
    expect(cfg.textProvider).toBe("claude");
    expect(cfg.visionProvider).toBe("openai");
  });

  it("stays saved, and an old per-task choice does not override it", async () => {
    await S.putConfig({ taskProviders: { general: "openai" } });
    expect(C.providerFor(C.effective(), "general")).toBe("openai");
    await S.putConfig({ provider: "claude", textProvider: "", visionProvider: "", models: { claude: { text: "admin-model", vision: "" } } });
    const cfg = C.effective(); // read again, as every AI call does
    expect(C.providerFor(cfg, "general")).toBe("claude");
    expect(cfg.models.claude[0]).toBe("admin-model");
    expect(C.loadSaved().taskProviders).toEqual({});
  });
});
