import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const api = vi.hoisted(() => ({
  aiModels: vi.fn(),
  chooseModel: vi.fn(),
  testModel: vi.fn(),
  aiConfig: vi.fn(),
  saveAiConfig: vi.fn(),
  aiProviderModels: vi.fn(),
  testAi: vi.fn(),
  aiUsage: vi.fn(),
}));

const period = (over = {}) => ({ calls: 0, ok: 0, failed: 0, fallbacks: 0, cost: 0, allPriced: true, providers: [], ...over });
const aiConfig = (over: Record<string, unknown> = {}) => ({
  provider: "ollama", textProvider: "ollama", visionProvider: "ollama", fallbackEnabled: false, fallbackProvider: null, taskProviders: {},
  providers: [
    { id: "ollama", label: "Ollama", local: true, keyConfigured: true, textModel: "gemma3:4b", visionModel: "gemma3:4b" },
    { id: "openai", label: "OpenAI", local: false, keyConfigured: true, textModel: "text-model-x", visionModel: "text-model-x" },
    { id: "gemini", label: "Gemini", local: false, keyConfigured: false, textModel: null, visionModel: null },
  ],
  dailyBudget: 0, monthlyBudget: 0, budgetOverride: false, currency: "INR",
  status: {
    text: { provider: "ollama", local: true, available: true, model: "gemma3:4b", detail: "ready" },
    vision: { provider: "ollama", local: true, available: true, model: "gemma3:4b", detail: "ready" },
  },
  budget: { exceeded: false, reason: null, dailySpent: null, monthlySpent: null },
  lastTest: null, mode: "local", vision: { maxFramesPerClip: 4, maxImageSize: 384, detail: "low" },
  ...over,
});

beforeEach(() => {
  api.aiConfig.mockResolvedValue(aiConfig());
  api.aiProviderModels.mockResolvedValue({ provider: "ollama", reachable: true, detail: null, models: [{ name: "gemma3:4b", vision: true }] });
  api.aiUsage.mockResolvedValue({ today: period(), week: period(), month: period(), currency: "INR",
                                  budget: { exceeded: false, reason: null, dailySpent: null, monthlySpent: null, daily: 0, monthly: 0, override: false } });
});
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));
vi.mock("@/hooks/useApi", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useApi")>()),
  useHealth: () => ({ data: { mongodb: true, ai: { provider: "ollama", available: true, model: "gemma3:4b", detail: "ready" } }, isLoading: false, error: null }),
}));

import SettingsPage from "@/app/settings/page";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings: choose the AI model", () => {
  const models = (over = {}) => ({
    provider: "ollama", reachable: true, detail: null, current: "gemma3:4b", source: "env", envModel: "gemma3:4b",
    needsVision: "Content analysis needs a model with vision.",
    models: [
      { name: "gemma3:4b", sizeGb: 3.3, capabilities: ["vision"], vision: true, thinking: false, embeddingOnly: false, current: true },
      { name: "qwen3.5:4b", sizeGb: 3.4, capabilities: ["vision", "thinking"], vision: true, thinking: true, embeddingOnly: false, current: false },
      { name: "nomic-embed", sizeGb: 0.3, capabilities: ["embedding"], vision: false, thinking: false, embeddingOnly: true, current: false },
    ],
    ...over,
  });

  it("lists installed models with what they can do and hides embedding-only ones", async () => {
    api.aiModels.mockResolvedValue(models());
    wrap(<SettingsPage />);
    const select = await screen.findByLabelText("AI model");
    const opts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(opts).toEqual(["gemma3:4b · 3.3 GB · vision (in use)", "qwen3.5:4b · 3.4 GB · vision · reasoning"]);
    expect(screen.getByText(/from OLLAMA_MODEL in .env/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this model" })).toBeDisabled(); // nothing to change yet
  });

  it("saves the chosen model and shows it as in use", async () => {
    api.aiModels.mockResolvedValue(models());
    api.chooseModel.mockResolvedValue(models({ current: "qwen3.5:4b", source: "settings" }));
    wrap(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("AI model"), "qwen3.5:4b");
    expect(screen.getByText(/turns that off for structured answers/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use this model" }));
    await waitFor(() => expect(api.chooseModel).toHaveBeenCalledWith("qwen3.5:4b"));
    expect(await screen.findByText(/\(chosen here\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go back to the .env model \(gemma3:4b\)/ })).toBeInTheDocument();
  });

  it("tests a model without switching to it and reports the verdict honestly", async () => {
    api.aiModels.mockResolvedValue(models());
    api.testModel.mockResolvedValue({ model: "qwen3.5:4b", ok: false, seconds: 109.2, verdict: "over-eager", detail: "Understood it but also added actions you did not ask for: style." });
    wrap(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("AI model"), "qwen3.5:4b");
    await userEvent.click(screen.getByRole("button", { name: "Test it" }));
    const box = await screen.findByRole("status", { name: "Model test result" });
    expect(box).toHaveTextContent("qwen3.5:4b: Added actions nobody asked for · 109.2s");
    expect(box).toHaveTextContent("also added actions you did not ask for: style");
    expect(api.chooseModel).not.toHaveBeenCalled();
  });

  it("explains when Ollama is not running", async () => {
    api.aiModels.mockResolvedValue(models({ reachable: false, detail: "Cannot reach Ollama at http://localhost:11434.", models: [] }));
    wrap(<SettingsPage />);
    expect(await screen.findByText("Ollama is not reachable")).toBeInTheDocument();
    expect(screen.getByText(/Cannot reach Ollama/)).toBeInTheDocument();
  });

  it("warns when the chosen model has no vision", async () => {
    api.aiModels.mockResolvedValue(models({ models: [
      { name: "gemma3:4b", sizeGb: 3.3, capabilities: ["vision"], vision: true, thinking: false, embeddingOnly: false, current: true },
      { name: "phi:2b", sizeGb: 1.6, capabilities: ["completion"], vision: false, thinking: false, embeddingOnly: false, current: false },
    ] }));
    wrap(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("AI model"), "phi:2b");
    expect(screen.getByText(/does not report vision/)).toBeInTheDocument();
  });
});

describe("Settings: AI provider, fallback, test, usage", () => {
  it("shows the provider choice, LOCAL AI badge and never asks for an API key in the browser", async () => {
    api.aiModels.mockResolvedValue({ provider: "ollama", reachable: true, detail: null, current: "gemma3:4b", source: "env", envModel: "gemma3:4b", needsVision: "", models: [] });
    wrap(<SettingsPage />);
    const select = await screen.findByLabelText("AI Provider");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Ollama (local)", "OpenAI (cloud)", "Gemini (no API key)"]);
    expect(screen.getAllByText("LOCAL AI").length).toBeGreaterThan(0);
    await userEvent.selectOptions(select, "gemini");
    expect(screen.getByText(/GEMINI_API_KEY to the backend/)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("does not show the Ollama picker when Ollama is not in use", async () => {
    api.aiConfig.mockResolvedValue(aiConfig({ provider: "openai", textProvider: "openai", visionProvider: "openai", mode: "cloud",
      status: { text: { provider: "openai", local: false, available: true, model: "text-model-x", detail: "ready" },
                vision: { provider: "openai", local: false, available: true, model: "text-model-x", detail: "ready" } } }));
    wrap(<SettingsPage />);
    expect((await screen.findAllByText("CLOUD AI")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Ollama model (on this computer)")).toBeNull();
    expect(api.aiModels).not.toHaveBeenCalled();
  });

  it("saves provider, models and fallback, then tests the connection", async () => {
    api.aiModels.mockResolvedValue({ provider: "ollama", reachable: true, detail: null, current: "gemma3:4b", source: "env", envModel: "gemma3:4b", needsVision: "", models: [] });
    api.aiProviderModels.mockImplementation((p: string) => Promise.resolve({ provider: p, reachable: true, detail: null,
      models: p === "openai" ? [{ name: "text-model-x", vision: null }, { name: "text-model-y", vision: null }] : [{ name: "gemma3:4b", vision: true }] }));
    api.saveAiConfig.mockResolvedValue(aiConfig());
    api.testAi.mockResolvedValue({ provider: "openai", model: "text-model-y", ok: true, correct: true, detail: "Connected; the answer was correct.", latencyMs: 820 });
    wrap(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("AI Provider"), "openai");
    await userEvent.selectOptions(await screen.findByLabelText("Text Model"), "text-model-y");
    await userEvent.click(screen.getByLabelText("Enable fallback"));
    await userEvent.selectOptions(screen.getByLabelText("Fallback Provider"), "gemini");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveAiConfig).toHaveBeenCalled());
    const body = api.saveAiConfig.mock.calls[0][0];
    expect(body).toMatchObject({ provider: "openai", fallbackEnabled: true, fallbackProvider: "gemini", models: { openai: { text: "text-model-y" } } });
    await userEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    const box = await screen.findByRole("status", { name: "AI test result" });
    expect(box).toHaveTextContent("openai · text-model-y: connected · 0.8s");
  });

  it("shows usage per period with cost and provider breakdown", async () => {
    api.aiModels.mockResolvedValue({ provider: "ollama", reachable: true, detail: null, current: "gemma3:4b", source: "env", envModel: "gemma3:4b", needsVision: "", models: [] });
    api.aiUsage.mockResolvedValue({
      today: period({ calls: 12, ok: 11, failed: 1, cost: 3.5, providers: [{ provider: "openai", calls: 12, ok: 11, failed: 1, cost: 3.5 }] }),
      week: period({ calls: 30, ok: 30, cost: 9 }), month: period({ calls: 80, ok: 78, failed: 2, cost: 20, allPriced: false }), currency: "INR",
      budget: { exceeded: true, reason: "today's AI budget is used up", dailySpent: 3.5, monthlySpent: 20, daily: 3, monthly: 0, override: false },
    });
    wrap(<SettingsPage />);
    expect(await screen.findByText("12 calls")).toBeInTheDocument();
    expect(screen.getByText(/Estimated cost: ₹3.50/)).toBeInTheDocument();
    expect(screen.getByText(/some models not priced/)).toBeInTheDocument();
    expect(screen.getByText(/today's AI budget is used up/)).toBeInTheDocument();
  });
});
