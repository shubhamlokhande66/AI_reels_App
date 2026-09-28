import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const api = vi.hoisted(() => ({
  voices: vi.fn(),
  systemVoices: vi.fn(),
  createVoice: vi.fn(),
  updateVoice: vi.fn(),
  deleteVoice: vi.fn(),
  previewVoice: vi.fn(),
  brands: vi.fn(),
  createBrand: vi.fn(),
  updateBrand: vi.fn(),
  deleteBrand: vi.fn(),
  uploadLogo: vi.fn(),
  templates: vi.fn(),
  createTemplate: vi.fn(),
  generateTemplate: vi.fn(),
  favoriteTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  script: vi.fn(),
  saveScript: vi.fn(),
  hooks: vi.fn(),
  generateScript: vi.fn(),
  reviseScript: vi.fn(),
  generateVoice: vi.fn(),
  removeVoice: vi.fn(),
  strategies: vi.fn(),
  variations: vi.fn(),
  understand: vi.fn(),
  duplicate: vi.fn(),
  performance: vi.fn(),
  library: vi.fn(),
  librarySearch: vi.fn(),
  patchMedia: vi.fn(),
  revise: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));
vi.mock("@/hooks/useApi", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useApi")>()),
  useStyles: () => ({ data: [{ id: "luxury", name: "Luxury", description: "", captionStyle: "luxury" }, { id: "fast_trending", name: "Fast Trending", description: "", captionStyle: "bold" }] }),
  useTrends: () => ({ data: [] }),
}));

import BrandsPage from "@/app/brands/page";
import TemplatesPage from "@/app/templates/page";
import VoicesPage from "@/app/voices/page";
import { ScriptVoicePanel } from "@/components/editor/ScriptVoicePanel";
import { PerformanceForm, ProjectTools } from "@/components/ProjectTools";
import { ReviseBox } from "@/components/ReviseBox";
import { stashTemplateDraft } from "@/lib/templateDraftHandoff";
import type { EdlTimeline, Project, Rendering, TemplateInput } from "@/types/api";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const voiceProfile = { id: "v1", name: "Warm", voice: null, language: "en", speed: 1, pitch: 0, energy: "medium", emotion: "friendly", pauseStyle: "natural", pronunciations: { Namora: "Nuh-more-uh" } };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  api.voices.mockResolvedValue([voiceProfile]);
  api.systemVoices.mockResolvedValue({
    provider: "sapi", available: true, voices: [{ id: "x", name: "Zira", language: "en-US", gender: "female" }],
    languages: { en: true, hi: false, mr: false }, note: "Hindi and Marathi need a Windows voice pack.",
  });
  api.brands.mockResolvedValue([]);
  api.templates.mockResolvedValue([]);
  api.strategies.mockResolvedValue([
    { id: "a", label: "Version A", description: "", style: "x", order: "y" },
    { id: "b", label: "Version B", description: "", style: "x", order: "y" },
    { id: "c", label: "Version C", description: "", style: "x", order: "y" },
    { id: "d", label: "Version D", description: "", style: "x", order: "y" },
  ]);
});

describe("Voices page", () => {
  it("shows honest language coverage and lists profiles", async () => {
    wrap(<VoicesPage />);
    expect(await screen.findByText("Warm")).toBeInTheDocument();
    expect(await screen.findByText(/Hindi: no voice installed/)).toBeInTheDocument();
    expect(screen.getByText(/English: voice available/)).toBeInTheDocument();
    expect(screen.getByText(/Hindi and Marathi need a Windows voice pack/)).toBeInTheDocument();
  });

  it("saves a profile with parsed pronunciations", async () => {
    api.createVoice.mockResolvedValue(voiceProfile);
    wrap(<VoicesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /New voice profile/ }));
    await userEvent.type(screen.getByPlaceholderText(/My Marathi Voice/), "Crisp");
    await userEvent.type(screen.getByLabelText("Pronunciation"), "GIF = jif");
    await userEvent.click(screen.getByRole("button", { name: "Save voice profile" }));
    await waitFor(() => expect(api.createVoice).toHaveBeenCalled());
    expect(api.createVoice.mock.calls[0][0]).toMatchObject({ name: "Crisp", pronunciations: { GIF: "jif" }, language: "en" });
  });
});

describe("Brands page", () => {
  it("creates a brand with colours, defaults and no logo", async () => {
    api.createBrand.mockResolvedValue({ id: "b1" });
    wrap(<BrandsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /New brand/ }));
    await userEvent.type(screen.getByPlaceholderText("e.g. NAMORA"), "NAMORA");
    await userEvent.type(screen.getByPlaceholderText("Shop the collection"), "Shop now");
    await userEvent.click(screen.getByRole("button", { name: "Save brand" }));
    await waitFor(() => expect(api.createBrand).toHaveBeenCalled());
    expect(api.createBrand.mock.calls[0][0]).toMatchObject({ name: "NAMORA", cta: "Shop now", watermark: { enabled: true, position: "br" } });
    expect(api.uploadLogo).not.toHaveBeenCalled();
  });
});

describe("Templates page", () => {
  const builtin = { id: "luxury_product", name: "Luxury Product", description: "Slow.", duration: 15, style: "luxury", pace: "calm", hook: false, captions: false,
    captionStyle: "luxury", audioMode: "music", musicSync: true, ai: false, language: "en", exportPreset: "instagram_reel", builtin: true, favorite: false, uses: 2 };

  it("lists templates, links to the create form and cannot delete built-ins", async () => {
    api.templates.mockResolvedValue([builtin]);
    wrap(<TemplatesPage />);
    expect(await screen.findByText("Luxury Product")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Use template" })).toHaveAttribute("href", "/projects/new?template=luxury_product");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeInTheDocument();
  });

  it("shows an AI draft for review and only saves after the user confirms", async () => {
    const { id: _id, builtin: _b, favorite: _f, uses: _u, ...draft } = builtin;
    void _id; void _b; void _f; void _u;
    api.generateTemplate.mockResolvedValue({ draft: true, template: { ...draft, name: "Jewellery Reveal" } });
    api.createTemplate.mockResolvedValue({});
    wrap(<TemplatesPage />);
    await userEvent.type(await screen.findByLabelText("Template idea"), "luxury jewellery reels");
    await userEvent.click(screen.getByRole("button", { name: /Draft with AI/ }));
    expect(await screen.findByText(/This is an AI draft/)).toBeInTheDocument();
    expect(api.createTemplate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(api.createTemplate).toHaveBeenCalled());
    expect(api.createTemplate.mock.calls[0][0]).toMatchObject({ name: "Jewellery Reveal", style: "luxury" });
  });

  it("picks up a template drafted in Chat and opens it for review", async () => {
    const { id: _id, builtin: _b, favorite: _f, uses: _u, ...draft } = builtin;
    void _id; void _b; void _f; void _u;
    stashTemplateDraft({ ...draft, name: "From Chat" } as TemplateInput);
    api.templates.mockResolvedValue([builtin]);
    wrap(<TemplatesPage />);

    expect(await screen.findByText(/AI draft from your Chat conversation/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("From Chat")).toBeInTheDocument();
    expect(sessionStorage.getItem("chat-template-draft")).toBeNull(); // read once, then cleared
  });
});

const timeline = (voice: EdlTimeline["voice"] = null): EdlTimeline => ({
  duration: 12, bpm: 110, audioStart: 0, style: "cinematic", captionStyle: "minimal", musicVolume: 1, musicFadeIn: null, musicFadeOut: null,
  warnings: [], notes: [], segments: [], captions: [], voice,
});
const script = { language: "en", lines: [{ text: "Meet the new collection.", pauseAfter: null }, { text: "Made by hand.", pauseAfter: 0.4 }], hook: "Wait for it", cta: null, tone: "", voiceProfileId: "v1", estimatedSeconds: 5.2 };

describe("ScriptVoicePanel", () => {
  beforeEach(() => {
    api.script.mockResolvedValue(script);
    api.saveScript.mockResolvedValue(script);
  });

  it("shows the editable script with its estimated spoken length", async () => {
    wrap(<ScriptVoicePanel projectId="p1" timeline={timeline()} busy={false} onEdit={() => {}} onState={() => {}} />);
    expect(await screen.findByLabelText("Line 1")).toHaveValue("Meet the new collection.");
    expect(screen.getByLabelText("Pause after line 2")).toHaveValue(0.4);
    expect(screen.getByText(/Spoken length ≈ 5.2s/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Voice volume")).not.toBeInTheDocument();
  });

  it("lets the user pick one of three generated hooks", async () => {
    api.hooks.mockResolvedValue({ hooks: ["First", "Second", "Third"], language: "en" });
    wrap(<ScriptVoicePanel projectId="p1" timeline={timeline()} busy={false} onEdit={() => {}} onState={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /Generate 3 hooks/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Second" }));
    expect(screen.getByLabelText("Hook")).toHaveValue("Second");
  });

  it("saves the script, then speaks it and hands the new timeline to the editor", async () => {
    const state = { timeline: timeline(), version: 4, canUndo: true, canRedo: false, index: 1, history: [] };
    api.generateVoice.mockResolvedValue({ state, voice: { duration: 5, voice: "Zira", lines: 2 } });
    const onState = vi.fn();
    wrap(<ScriptVoicePanel projectId="p1" timeline={timeline()} busy={false} onEdit={() => {}} onState={onState} />);
    await userEvent.click(await screen.findByRole("button", { name: "Generate voice-over" }));
    await waitFor(() => expect(onState).toHaveBeenCalledWith(state));
    expect(api.generateVoice).toHaveBeenCalledWith("p1", "v1");
    expect(api.saveScript.mock.invocationCallOrder[0]).toBeLessThan(api.generateVoice.mock.invocationCallOrder[0]);
  });

  it("offers mix controls once a voice exists and removing it", async () => {
    const voice = { fileKey: "k", duration: 5, start: 0.3, volume: 1, duckMusic: true, profileName: "Warm", language: "en", lines: [] };
    const onEdit = vi.fn();
    wrap(<ScriptVoicePanel projectId="p1" timeline={timeline(voice)} busy={false} onEdit={onEdit} onState={() => {}} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Lower the music/ }));
    expect(onEdit).toHaveBeenCalledWith([{ type: "set_voice_mix", duckMusic: false }], "Music ducking");
    expect(screen.getByRole("button", { name: "Remove voice-over" })).toBeInTheDocument();
  });
});

const project = (over: Partial<Project> = {}) =>
  ({ id: "p1", name: "P", status: "completed", settings: { language: "en", audioMode: "music" }, videos: [{ id: "c1" }], audio: { id: "a1" }, ...over }) as unknown as Project;

describe("ProjectTools", () => {
  it("starts content analysis", async () => {
    api.understand.mockResolvedValue({ id: "j1" });
    wrap(<ProjectTools project={project()} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Analyse content" }));
    await waitFor(() => expect(api.understand).toHaveBeenCalledWith("p1"));
  });

  it("creates only the chosen variation strategies", async () => {
    api.variations.mockResolvedValue({ id: "j2" });
    wrap(<ProjectTools project={project()} busy={false} />);
    await screen.findByRole("checkbox", { name: "Version D" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Version B" })); // untick one of the three defaults
    await userEvent.click(screen.getByRole("checkbox", { name: "Version D" }));
    await userEvent.click(screen.getByRole("button", { name: /Create 3 variations/ }));
    await waitFor(() => expect(api.variations).toHaveBeenCalled());
    expect(api.variations.mock.calls[0][1].sort()).toEqual(["a", "c", "d"]);
  });

  it("makes a language variant and opens it", async () => {
    api.duplicate.mockResolvedValue({ id: "p2", name: "P (hi)" });
    wrap(<ProjectTools project={project()} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Language variant" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p2"));
    expect(api.duplicate).toHaveBeenCalledWith("p1", { variant: "language", language: "hi" });
  });

  it("is disabled while a job runs", () => {
    wrap(<ProjectTools project={project()} busy />);
    expect(screen.getByRole("button", { name: "Analyse content" })).toBeDisabled();
  });
});

describe("PerformanceForm", () => {
  it("stores the numbers the user typed and states nothing is fetched", async () => {
    api.performance.mockResolvedValue({});
    const r = { id: "r1", projectId: "p1" } as Rendering;
    wrap(<PerformanceForm rendering={r} />);
    await userEvent.click(screen.getByRole("button", { name: "Add posting results" }));
    expect(screen.getByText(/only used for your own insights/)).toBeInTheDocument();
    const views = screen.getByLabelText("Views");
    await userEvent.clear(views);
    await userEvent.type(views, "1200");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.performance).toHaveBeenCalled());
    expect(api.performance.mock.calls[0].slice(0, 2)).toEqual(["p1", "r1"]);
    expect(api.performance.mock.calls[0][2]).toMatchObject({ views: 1200, platform: "instagram", completionRate: null });
  });
});

describe("ReviseBox (change a Reel with words)", () => {
  const result = (over = {}) => ({
    mode: "edit", understood: [{ text: "remove the first clip", does: "Remove the first shot", source: "rules", rebuild: false }],
    notUnderstood: [], warnings: [], notes: [], usedAi: false, aiNote: null, examples: ["make it calmer with longer shots"], job: { id: "j9" }, ...over,
  });

  it("sends the words on Regenerate, shows what was understood and clears the box", async () => {
    api.revise.mockResolvedValue(result());
    wrap(<ReviseBox projectId="p1" busy={false} />);
    const box = screen.getByLabelText("What should change?");
    expect(screen.getByRole("button", { name: /Regenerate/ })).toBeDisabled();
    await userEvent.type(box, "remove the first clip");
    await userEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    await waitFor(() => expect(api.revise).toHaveBeenCalledWith("p1", "remove the first clip", false));
    expect(await screen.findByText("Remove the first shot")).toBeInTheDocument();
    expect(screen.getByText("Changing:")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("can check first without changing anything", async () => {
    api.revise.mockResolvedValue(result({ job: null }));
    wrap(<ReviseBox projectId="p1" busy={false} />);
    await userEvent.type(screen.getByLabelText("What should change?"), "remove the first clip");
    await userEvent.click(screen.getByRole("button", { name: "Check what it will do" }));
    await waitFor(() => expect(api.revise).toHaveBeenCalledWith("p1", "remove the first clip", true));
    expect(await screen.findByText("This would:")).toBeInTheDocument();
    expect(screen.getByLabelText("What should change?")).toHaveValue("remove the first clip"); // kept so the user can go on
  });

  it("is honest about what it did not understand and about rebuild warnings", async () => {
    api.revise.mockResolvedValue(result({
      mode: "none", understood: [], notUnderstood: ["make it dreamy"], aiNote: "AI assist is not available, so only the phrases I know were applied.",
      warnings: ["Rebuilding starts a new edit."], job: null,
    }));
    wrap(<ReviseBox projectId="p1" busy={false} />);
    await userEvent.type(screen.getByLabelText("What should change?"), "make it dreamy");
    await userEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    expect(await screen.findByRole("listitem")).toHaveTextContent("make it dreamy");
    expect(screen.getByText(/only the phrases I know/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
    expect(screen.getByText("Rebuilding starts a new edit.")).toBeInTheDocument();
  });

  it("AI-interpreted changes are shown first and only applied after the user confirms that exact plan", async () => {
    const plan = [{ kind: "speed", scope: "last", factor: 0.5, source: "ai", text: "speed" }];
    api.revise.mockResolvedValueOnce(result({
      understood: [{ text: "speed", does: "Playback speed of the last shot: slower", source: "ai", rebuild: false }],
      needsConfirmation: true, actions: plan, job: null,
    }));
    wrap(<ReviseBox projectId="p1" busy={false} />);
    await userEvent.type(screen.getByLabelText("What should change?"), "make the ending dramatic");
    await userEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    expect(await screen.findByText("I think you mean:")).toBeInTheDocument();
    expect(screen.getByText("AI-interpreted")).toBeInTheDocument();
    expect(screen.getByText(/nothing has been changed yet/)).toBeInTheDocument();
    expect(screen.getByLabelText("What should change?")).toHaveValue("make the ending dramatic"); // not cleared: nothing was applied

    api.revise.mockResolvedValueOnce(result({ needsConfirmation: false, actions: plan }));
    await userEvent.click(screen.getByRole("button", { name: "Apply these changes" }));
    await waitFor(() => expect(api.revise).toHaveBeenLastCalledWith("p1", "make the ending dramatic", false, plan));
    expect(await screen.findByText("Changing:")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply these changes" })).not.toBeInTheDocument();
  });

  it("idea chips build the request and everything is locked while a render runs", async () => {
    wrap(<ReviseBox projectId="p1" busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Add captions" }));
    await userEvent.click(screen.getByRole("button", { name: "Louder music" }));
    expect(screen.getByLabelText("What should change?")).toHaveValue("Add captions, louder music");
    cleanupBusy();
  });

  function cleanupBusy() {
    wrap(<ReviseBox projectId="p2" busy />);
    expect(screen.getAllByLabelText("What should change?")[1]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rendering…" })).toBeDisabled();
  }

  it("initialText pre-fills the box (from a prompt typed on the AI Edit create page) without running it on its own", () => {
    wrap(<ReviseBox projectId="p1" busy={false} initialText="make it calmer" />);
    expect(screen.getByLabelText("What should change?")).toHaveValue("make it calmer");
    expect(api.revise).not.toHaveBeenCalled();
  });

  it("autoRun sends the pre-filled prompt itself, once, as soon as the Reel is ready (not busy)", async () => {
    api.revise.mockResolvedValue(result());
    const { rerender } = wrap(<ReviseBox projectId="p1" busy initialText="make it calmer" autoRun />);
    expect(api.revise).not.toHaveBeenCalled(); // still rendering the first Reel: waits

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReviseBox projectId="p1" busy={false} initialText="make it calmer" autoRun />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.revise).toHaveBeenCalledWith("p1", "make it calmer", false));
    expect(api.revise).toHaveBeenCalledTimes(1); // never repeats itself on later re-renders

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReviseBox projectId="p1" busy={false} initialText="make it calmer" autoRun />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(api.revise).toHaveBeenCalledTimes(1);
  });

  it("autoRun still asks for confirmation when the AI has to interpret the prompt — nothing changes silently", async () => {
    const plan = [{ kind: "speed", scope: "last", factor: 0.5, source: "ai", text: "dramatic" }];
    api.revise.mockResolvedValue(result({
      understood: [{ text: "dramatic", does: "Playback speed of the last shot: slower", source: "ai", rebuild: false }],
      needsConfirmation: true, actions: plan, job: null,
    }));
    wrap(<ReviseBox projectId="p1" busy={false} initialText="make the ending dramatic" autoRun />);
    expect(await screen.findByText("I think you mean:")).toBeInTheDocument();
    expect(screen.getByText(/nothing has been changed yet/)).toBeInTheDocument();
  });

  it("without autoRun, a pre-filled prompt just sits in the box until the user presses Regenerate themselves", async () => {
    wrap(<ReviseBox projectId="p1" busy={false} initialText="make it calmer" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(api.revise).not.toHaveBeenCalled();
  });
});
