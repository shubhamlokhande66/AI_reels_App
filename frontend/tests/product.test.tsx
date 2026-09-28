import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProductPlan } from "@/types/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));

const api = vi.hoisted(() => ({
  productStyles: vi.fn(),
  createProject: vi.fn(),
  uploadImages: vi.fn(),
  uploadAudio: vi.fn(),
  generateProduct: vi.fn(),
  // used by the video form when the switch shows it
  templates: vi.fn(),
  brands: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));
vi.mock("@/hooks/useApi", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useApi")>()),
  useTrends: () => ({ data: [] }),
  useDeleteProject: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { NewReel } from "@/components/NewReel";
import { ProductProjectView } from "@/components/ProductProjectView";
import { ProductReelForm } from "@/components/ProductReelForm";
import { ShotList } from "@/components/ShotList";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const STYLES = [
  { id: "luxury_jewelry", name: "Luxury jewellery", description: "Slow, elegant." },
  { id: "clean_product", name: "Clean product", description: "Crisp." },
  { id: "energetic", name: "Energetic", description: "Punchy." },
];
const photo = (n = "ring.jpg") => new File(["x"], n, { type: "image/jpeg" });
const addFiles = (selector: string, files: File[]) => fireEvent.change(document.querySelector(selector) as HTMLInputElement, { target: { files } });
const IMAGE_INPUT = "input[accept*='image/*']";
const AUDIO_INPUT = "input[accept*='audio/*']";

beforeEach(() => {
  vi.clearAllMocks();
  api.productStyles.mockResolvedValue(STYLES);
  api.createProject.mockResolvedValue({ id: "p1" });
  api.uploadImages.mockResolvedValue({ uploaded: [{ id: "i1" }], failed: [] });
  api.uploadAudio.mockResolvedValue({});
  api.generateProduct.mockResolvedValue({ id: "j1" });
  api.templates.mockResolvedValue([]);
  api.brands.mockResolvedValue([]);
  class QuietAudio {
    readyState = 1;
    currentTime = 0;
    paused = true;
    play() { return Promise.resolve(); }
    pause() {}
    load() {}
    addEventListener() {}
  }
  vi.stubGlobal("Audio", QuietAudio);
});

const plan = (over: Partial<ProductPlan> = {}): ProductPlan => ({
  style: "luxury_jewelry", duration: 8, fps: 30, bpm: 112, audioStart: 0,
  concept: { hook: "Opens on the finest detail.", story: "10 micro-shots.", ending: "A calm final frame." },
  images: ["i1"], loop: false, warnings: ["ring.jpg: The photo is 900x1200: close-ups are limited."], notes: ["No music: steady rhythm."],
  texts: [{ id: "t1", text: "The Solitaire", start: 3.3, end: 5.3, x: 0.5, y: 0.14, size: 0.07, animationIn: "mask_reveal", role: "hook" }],
  shots: [
    { index: 0, start: 0, end: 0.5, purpose: "hook", framing: "extreme_close_up", imageIndex: 0, camera: { type: "pull_out", ease: "in_out", start: { cx: 0.5, cy: 0.4, hh: 0.5, roll: 0 }, end: { cx: 0.5, cy: 0.4, hh: 0.6, roll: 0 } },
      effects: [{ type: "light_sweep", at: 0, duration: 0.5, strength: 0.5, x: null, y: null, onBeat: false }], transitionIn: { type: "fade_from_black", duration: 0.35 }, beatTime: 0, note: "Stop the scroll" },
    { index: 1, start: 0.5, end: 3.5, purpose: "reveal", framing: "medium", imageIndex: 0, camera: { type: "drift", ease: "in_out", start: { cx: 0.5, cy: 0.5, hh: 0.9, roll: -0.9 }, end: { cx: 0.5, cy: 0.5, hh: 0.9, roll: 0.9 } },
      effects: [], transitionIn: { type: "blur", duration: 0.28 }, beatTime: 0.5, note: "" },
    { index: 2, start: 3.5, end: 8, purpose: "cta", framing: "hero", imageIndex: 0, camera: { type: "hold", ease: "linear", start: { cx: 0.5, cy: 0.5, hh: 1.1, roll: 0 }, end: { cx: 0.5, cy: 0.5, hh: 1.1, roll: 0 } },
      effects: [{ type: "sparkle", at: 0.1, duration: 0.3, strength: 0.9, x: 0.4, y: 0.5, onBeat: true }], transitionIn: { type: "cut", duration: 0 }, beatTime: 3.5, note: "" },
  ],
  quality: [{ name: "Timeline is continuous", ok: true, detail: "3 shots covering 8s" }, { name: "Transitions are varied", ok: false, detail: "1 kind: blur" }],
  ...over,
});

const project = (over: Partial<Project> = {}) =>
  ({
    id: "p1", name: "Ring launch", status: "completed", latestJob: null, error: null,
    settings: { reelType: "product", productStyle: "luxury_jewelry", hookText: "The Solitaire", taglineText: "", ctaText: "Shop now", loop: false, duration: 8 },
    images: [{ id: "i1", name: "ring.jpg", url: "/api/x/ring", thumbnailUrl: "/api/x/thumb" }],
    videos: [], productPlan: plan(),
    output: { id: "r1", url: "/api/x/r1", downloadUrl: "/api/x/r1?download=1", duration: 8, width: 1080, height: 1920, size: 2_500_000, createdAt: "2026-09-21T10:00:00Z" },
    preview: null, ...over,
  }) as unknown as Project;

describe("Create Reel: choosing what to make", () => {
  it("offers both kinds and shows the matching form", async () => {
    wrap(<NewReel />);
    const group = screen.getByRole("radiogroup", { name: "What do you want to make?" });
    expect(within(group).getByRole("radio", { name: /Edit my video clips/ })).toBeChecked();
    expect(screen.getByRole("form", { name: "Create Reel" })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("radio", { name: /Product Reel from photos/ }));
    expect(screen.getByRole("form", { name: "Create product Reel" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Create Reel" })).not.toBeInTheDocument();
  });
});

describe("ProductReelForm", () => {
  it("needs a name and a photo, and says so", async () => {
    wrap(<ProductReelForm />);
    expect(screen.getByRole("button", { name: "Direct my Reel" })).toBeDisabled();
    expect(screen.getByText(/Add a name and at least one product photo/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Project name"), "Ring");
    expect(screen.getByRole("button", { name: "Direct my Reel" })).toBeDisabled();
    addFiles(IMAGE_INPUT, [photo()]);
    expect(await screen.findByAltText("ring.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Direct my Reel" })).toBeEnabled();
  });

  it("creates the project, uploads photos and music in order, and directs the Reel", async () => {
    wrap(<ProductReelForm />);
    await userEvent.type(screen.getByLabelText("Project name"), "Ring launch");
    addFiles(IMAGE_INPUT, [photo("a.jpg"), photo("b.png")]);
    await screen.findByAltText("a.jpg");
    await userEvent.click(await screen.findByRole("radio", { name: /Clean product/ }));
    await userEvent.type(screen.getByLabelText("Hook line"), "The Solitaire");
    await userEvent.type(screen.getByLabelText("Call to action"), "Shop now");
    await userEvent.click(screen.getByRole("checkbox", { name: /Make it loop/ }));
    await userEvent.click(screen.getByRole("radio", { name: "30s" }));
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await screen.findByLabelText("Part of the song");
    await userEvent.click(screen.getByRole("button", { name: "Direct my Reel" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject).toHaveBeenCalledWith("Ring launch", {
      reelType: "product", productStyle: "clean_product", hookText: "The Solitaire", taglineText: "", ctaText: "Shop now", loop: true, duration: 30, ai: true, aiDirector: true,
    });
    expect(api.uploadImages.mock.calls[0][1].map((f: File) => f.name)).toEqual(["a.jpg", "b.png"]);
    expect(api.uploadAudio.mock.calls[0][1].name).toBe("song.mp3");
    const order = [api.createProject, api.uploadImages, api.uploadAudio, api.generateProduct].map((m) => m.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(api.generateProduct).toHaveBeenCalledWith("p1");
  });

  it("works without music, and keeps the chosen part of the song when there is music", async () => {
    wrap(<ProductReelForm />);
    await userEvent.type(screen.getByLabelText("Project name"), "No music");
    addFiles(IMAGE_INPUT, [photo()]);
    await screen.findByAltText("ring.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Direct my Reel" }));
    await waitFor(() => expect(api.generateProduct).toHaveBeenCalled());
    expect(api.uploadAudio).not.toHaveBeenCalled();
    expect(api.createProject.mock.calls[0][1]).not.toHaveProperty("audioStart");
  });

  it("explains HEIC photos instead of failing later", async () => {
    wrap(<ProductReelForm />);
    addFiles(IMAGE_INPUT, [new File(["x"], "IMG_1.HEIC", { type: "image/heic" }), photo("ok.jpg")]);
    expect(await screen.findByRole("status")).toHaveTextContent(/HEIC photos can't be used yet.*IMG_1.HEIC/);
    expect(screen.getByAltText("ok.jpg")).toBeInTheDocument();
    expect(screen.queryByAltText("IMG_1.HEIC")).not.toBeInTheDocument();
  });

  it("lets a photo be removed", async () => {
    wrap(<ProductReelForm />);
    addFiles(IMAGE_INPUT, [photo("a.jpg"), photo("b.jpg")]);
    await screen.findByAltText("a.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Remove a.jpg" }));
    expect(screen.queryByAltText("a.jpg")).not.toBeInTheDocument();
    expect(screen.getByAltText("b.jpg")).toBeInTheDocument();
  });

  it("shows why it failed, and a retry does not create a second project", async () => {
    api.generateProduct.mockRejectedValueOnce(Object.assign(new Error("The Reel could not be made."), { code: "NO_IMAGES" }));
    wrap(<ProductReelForm />);
    await userEvent.type(screen.getByLabelText("Project name"), "Ring");
    addFiles(IMAGE_INPUT, [photo()]);
    await screen.findByAltText("ring.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Direct my Reel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The Reel could not be made.");
    await userEvent.click(screen.getByRole("button", { name: "Direct my Reel" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.uploadImages).toHaveBeenCalledTimes(1); // resumed, nothing uploaded twice
  });
});

describe("ShotList", () => {
  it("shows every micro-shot with its purpose, camera, transition, effects and text", () => {
    render(<ShotList plan={plan()} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("0.00–0.50");
    expect(rows[0]).toHaveTextContent("hook");
    expect(rows[0]).toHaveTextContent("extreme close up");
    expect(rows[0]).toHaveTextContent("pull out");
    expect(rows[0]).toHaveTextContent("fade from black");
    expect(rows[0]).toHaveTextContent("light sweep");
    expect(rows[1]).toHaveTextContent("micro sway"); // honest name for the small roll: not an orbit
    expect(rows[1]).toHaveTextContent("“The Solitaire”"); // the text layer shown against the shot it appears in
    expect(rows[2]).toHaveTextContent("sparkle");
    expect(rows[2]).toHaveTextContent("hold");
  });

  it("reports the quality check honestly, including what did not pass", () => {
    render(<ShotList plan={plan()} />);
    expect(screen.getByText(/1 of 2 passed/)).toBeInTheDocument();
    expect(screen.getByLabelText("failed")).toBeInTheDocument();
    expect(screen.getByText(/Transitions are varied/)).toBeInTheDocument();
    expect(screen.getByLabelText("Warnings")).toHaveTextContent("close-ups are limited");
    expect(screen.getByLabelText("Notes")).toHaveTextContent("No music");
    expect(screen.getByText(/3 micro-shots over 8.0s at 112 BPM/)).toBeInTheDocument();
  });

  it("says a steady rhythm when there is no music", () => {
    render(<ShotList plan={plan({ bpm: 0 })} />);
    expect(screen.getByText(/at a steady rhythm/)).toBeInTheDocument();
  });
});

describe("ProductProjectView", () => {
  it("shows the finished Reel, the photos and the director's plan", () => {
    wrap(<ProductProjectView project={project()} />);
    expect(screen.getByLabelText("Generated Reel")).toHaveAttribute("src", expect.stringContaining("/api/x/r1"));
    expect(screen.getByText(/Final · 0:08 · 1080×1920/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download MP4" })).toBeInTheDocument();
    expect(screen.getByAltText("ring.jpg")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Director's shot list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Hook line")).toHaveValue("The Solitaire");
  });

  it("directs again with the changed settings and a fresh seed", async () => {
    wrap(<ProductProjectView project={project()} />);
    await screen.findByRole("radio", { name: "Energetic" });
    await userEvent.click(screen.getByRole("radio", { name: "Energetic" }));
    await userEvent.clear(screen.getByLabelText("Call to action"));
    await userEvent.type(screen.getByLabelText("Call to action"), "Book now");
    await userEvent.click(screen.getByRole("checkbox", { name: "Make it loop" }));
    await userEvent.click(screen.getByRole("button", { name: /Direct again/ }));
    await waitFor(() => expect(api.generateProduct).toHaveBeenCalled());
    const [id, body] = api.generateProduct.mock.calls[0];
    expect(id).toBe("p1");
    expect(body).toMatchObject({ productStyle: "energetic", hookText: "The Solitaire", ctaText: "Book now", loop: true, quality: "final", label: "Directed again" });
    expect(body.seed).toBeGreaterThan(0);
  });

  it("offers a fast preview, and shows a newer preview as such", async () => {
    const withPreview = project({ preview: { id: "r2", url: "/api/x/r2", downloadUrl: "/api/x/r2?d=1", duration: 8, width: 540, height: 960, size: 400_000, createdAt: "2026-09-21T11:00:00Z" } as never });
    wrap(<ProductProjectView project={withPreview} />);
    expect(screen.getByLabelText("Preview")).toBeInTheDocument();
    expect(screen.getByText(/Fast preview \(lower quality\) · 0:08 · 540×960/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fast preview" }));
    await waitFor(() => expect(api.generateProduct).toHaveBeenCalledWith("p1", expect.objectContaining({ quality: "preview", seed: 0 })));
  });

  it("shows progress while directing and hides the controls", () => {
    const job = { id: "j", projectId: "p1", type: "product", status: "processing", progress: 40, stage: "planning_shots", error: null, renderingId: null, createdAt: "", updatedAt: "",
      stages: [{ name: "understanding_images", label: "Understanding the photos", status: "completed", progress: 100 }, { name: "planning_shots", label: "Planning the shots", status: "running", progress: 40 }] };
    wrap(<ProductProjectView project={project({ status: "processing", latestJob: job as never })} />);
    expect(screen.getByText("Directing your Reel…")).toBeInTheDocument();
    expect(screen.getByText("Planning the shots")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Direct again/ })).not.toBeInTheDocument();
  });

  it("explains a failure and can try again", () => {
    wrap(<ProductProjectView project={project({ status: "failed", output: null, error: { code: "CORRUPTED_IMAGE", message: "The image could not be read.", details: null } as never })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The image could not be read.");
    expect(screen.getByRole("button", { name: /Direct again/ })).toBeEnabled();
  });

  it("a draft with no output says nothing was directed, and cannot direct without photos", () => {
    wrap(<ProductProjectView project={project({ status: "draft", output: null, productPlan: null, images: [] })} />);
    expect(screen.getByText("Nothing directed yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Direct again/ })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Director's shot list" })).not.toBeInTheDocument();
  });
});
