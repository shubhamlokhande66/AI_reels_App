import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));

vi.mock("@/hooks/useApi", () => ({
  useTrends: () => ({
    data: [{ id: "cinematic_story", trendName: "Cinematic Story", recommendedDuration: 30, cutFrequency: "slow",
      transitionStyle: "smooth", captionStyle: "luxury", description: "" }],
  }),
}));

const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  uploadVideos: vi.fn(),
  uploadAudio: vi.fn(),
  generate: vi.fn(),
  templates: vi.fn(),
  brands: vi.fn(),
  references: vi.fn(),
  applyTemplate: vi.fn(),
  applyBrand: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import { CreateReelForm } from "@/components/CreateReelForm";

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateReelForm />
    </QueryClientProvider>,
  );
}
const addFiles = (selector: string, files: File[]) =>
  fireEvent.change(document.querySelector(selector) as HTMLInputElement, { target: { files } });
const video = (n: string) => new File(["v"], n, { type: "video/mp4" });
const VIDEO_INPUT = "input[accept*='.mp4']";
const AUDIO_INPUT = "input[accept*='.mp3']";

class QuietAudio {
  readyState = 1;
  currentTime = 0;
  paused = true;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  addEventListener() {}
}

beforeEach(() => {
  vi.stubGlobal("Audio", QuietAudio);
  vi.clearAllMocks();
  api.createProject.mockResolvedValue({ id: "p1" });
  api.uploadVideos.mockResolvedValue({ uploaded: [], failed: [] });
  api.uploadAudio.mockResolvedValue({});
  api.generate.mockResolvedValue({ id: "j1" });
  api.templates.mockResolvedValue([
    { id: "voiceover_explainer", name: "Voice-over Explainer", duration: 30, style: "cinematic", pace: "calm", captions: true,
      captionStyle: "minimal", audioMode: "voice_music", language: "en", ai: false, favorite: false },
  ]);
  api.brands.mockResolvedValue([{ id: "b1", name: "NAMORA" }]);
  api.references.mockResolvedValue([]);
  api.applyTemplate.mockResolvedValue({});
  api.applyBrand.mockResolvedValue({});
});

describe("CreateReelForm", () => {
  it("cannot submit until name, video and music are provided", async () => {
    renderForm();
    const btn = screen.getByRole("button", { name: "Generate Reel" });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Project name"), "My reel");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    expect(btn).toBeDisabled();
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("creates, uploads in order, starts the real job and navigates to the project", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Project name"), "  My reel ");
    addFiles(VIDEO_INPUT, [video("a.mp4"), video("b.mov")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("radio", { name: "30s" }));
    await userEvent.click(screen.getByRole("radio", { name: /Luxury/ }));
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject).toHaveBeenCalledWith("My reel", { duration: 30, style: "luxury", pace: "auto", sequence: "mixed", captions: false, captionStyle: "minimal", ai: true, aiDirector: true, autoReview: true, deleteMediaAfterRender: false, audioMode: "music", language: "en", brief: "", reference: "auto" });
    expect(api.uploadVideos.mock.calls[0][1].map((f: File) => f.name)).toEqual(["a.mp4", "b.mov"]);
    expect(api.uploadAudio.mock.calls[0][1].name).toBe("song.mp3");
    expect(api.generate).toHaveBeenCalledWith("p1");
  });

  it("pre-fills from a template, applies template and brand after creating, and needs no music for voice modes", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Project name"), "Explainer");
    await screen.findByRole("option", { name: "Voice-over Explainer" });
    await userEvent.selectOptions(screen.getByLabelText("Template"), "voiceover_explainer");
    await userEvent.selectOptions(screen.getByLabelText("Brand"), "b1");
    expect(screen.getByLabelText("Audio mode")).toHaveValue("voice_music");
    await userEvent.type(screen.getByLabelText("Instructions for the AI"), "Gold jewellery");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.uploadAudio).not.toHaveBeenCalled();
    expect(api.applyTemplate).toHaveBeenCalledWith("p1", "voiceover_explainer");
    expect(api.applyBrand).toHaveBeenCalledWith("p1", "b1");
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ duration: 30, style: "cinematic", pace: "calm", audioMode: "voice_music", brief: "Gold jewellery" });
  });

  it("still needs a song in music-only mode", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Project name"), "X");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    expect(screen.getByRole("button", { name: "Generate Reel" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Audio mode"), "none");
    expect(screen.getByRole("button", { name: "Generate Reel" })).toBeEnabled();
  });

  it("opens the phone gallery and music files: the pickers accept video/* and audio/*", () => {
    renderForm();
    expect(document.querySelector("input[accept*='video/*']")?.getAttribute("accept")).toContain(".mov");
    expect(document.querySelector("input[accept*='audio/*']")?.getAttribute("accept")).toContain(".mp3");
  });

  it("asks for the length before the music, and the song-part picker comes right after the song", async () => {
    renderForm();
    const heading = (name: RegExp) => screen.getByRole("heading", { name });
    const before = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(heading(/^Videos$/), heading(/^Duration$/))).toBe(true);
    expect(before(heading(/^Duration$/), heading(/^Music/))).toBe(true);
    expect(before(heading(/^Music/), heading(/^Pace$/))).toBe(true);
    expect(screen.getByText(/Choose the length first/)).toBeInTheDocument();
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    const picker = await screen.findByLabelText("Part of the song");
    expect(before(heading(/^Music/), picker)).toBe(true);
    expect(before(picker, heading(/^Pace$/))).toBe(true);
  });

  it("has ONE music section: the song's file and the part of it to use are in the same card", async () => {
    renderForm();
    expect(screen.getAllByRole("heading", { name: /^Music/ })).toHaveLength(1);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    const picker = await screen.findByLabelText("Part of the song");
    const fileName = screen.getByText("song.mp3");
    const card = fileName.closest("div.rounded-2xl") as HTMLElement; // the shared Card
    expect(card).not.toBeNull();
    expect(card.contains(picker)).toBe(true); // the picker is inside the file's card, not a second box
    expect(card.contains(screen.getByRole("button", { name: "Remove music" }))).toBe(true);
    expect(screen.queryByLabelText("Music preview")).not.toBeInTheDocument(); // no second player: the picker plays the song
    expect(screen.getAllByLabelText("Part of the song")).toHaveLength(1);
  });

  it("offers the part-of-song picker whenever the song is played (music, voice + music) and not when it is not", async () => {
    renderForm();
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await screen.findByLabelText("Part of the song");
    await userEvent.selectOptions(screen.getByLabelText("Audio mode"), "voice_music");
    expect(screen.getByLabelText("Part of the song")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Audio mode"), "voice");
    expect(screen.queryByLabelText("Part of the song")).not.toBeInTheDocument();
    expect(screen.getByText(/does not use the song/)).toBeInTheDocument();
  });

  it("creates a two-minute Reel from a chosen part of the song", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Project name"), "Long one");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("radio", { name: "Custom" }));
    await userEvent.click(screen.getByRole("button", { name: "2 min" }));
    // the picker appears once a song is chosen; the user takes control of the start
    await userEvent.click(await screen.findByRole("checkbox", { name: /Let the app choose/ }));
    const start = screen.getByLabelText("Start time");
    await userEvent.clear(start);
    await userEvent.type(start, "1:15");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ duration: 120, audioStart: 75 });
  });

  it("makes a step-by-step Reel (recipes, tutorials) when asked, and says how the order is decided", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Project name"), "Aloo paratha");
    addFiles(VIDEO_INPUT, [video("VID-20240101-WA0002.mp4"), video("VID-20240101-WA0001.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    expect(screen.getByRole("radio", { name: /Best moments/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: /Step by step/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Show “Step 1”/ }));
    expect(screen.getByRole("checkbox", { name: /quick look at the finished dish/ })).toBeChecked();
    expect(screen.getByText(/Clips follow the time in their file names/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ sequence: "steps", teaser: true, stepLabels: false, orderMode: "auto" });
  });

  it("lets you set the clip order yourself for a step-by-step Reel, with ↑ / ↓ to reorder", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Project name"), "Aloo paratha");
    addFiles(VIDEO_INPUT, [video("a.mp4"), video("b.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("radio", { name: /Step by step/ }));
    await userEvent.click(screen.getByRole("radio", { name: /My order/ }));
    expect(screen.getByText(/Drag a clip above to any position/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Move b.mp4 up" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ sequence: "steps", orderMode: "manual" });
    expect(api.uploadVideos.mock.calls[0][1].map((f: File) => f.name)).toEqual(["b.mp4", "a.mp4"]);
  });

  it("does not send a start when the app is left to choose the part", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Project name"), "Auto");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await screen.findByRole("checkbox", { name: /Let the app choose/ });
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject.mock.calls[0][1]).not.toHaveProperty("audioStart");
  });

  it("has AI assist on by default (quality over speed) and offers the Auto style; it can be turned off for a fast draft", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: /Auto/ }));
    expect(screen.getByRole("switch", { name: /AI assist/ })).toBeChecked();
    expect(screen.getByText(/a few minutes per clip/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Project name"), "AI");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ style: "auto", ai: true });
  });

  it("can turn AI assist off for a fast draft", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("switch", { name: /AI assist/ }));
    await userEvent.type(screen.getByLabelText("Project name"), "Fast"); 
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ ai: false });
  });

  it("offers caption styles once captions are on and sends them", async () => {
    renderForm();
    expect(screen.queryByRole("radiogroup", { name: "Caption style" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: /Captions/ }));
    await userEvent.click(screen.getByRole("radio", { name: "karaoke" }));
    await userEvent.type(screen.getByLabelText("Project name"), "Cap");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ captions: true, captionStyle: "karaoke" });
  });

  it("a trend preset pre-fills duration and caption style and is sent as trendId", async () => {
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText(/Trend preset/), "cinematic_story");
    expect(screen.getByRole("radio", { name: "30s" })).toBeChecked();
    await userEvent.type(screen.getByLabelText("Project name"), "T");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ trendId: "cinematic_story", duration: 30, captionStyle: "luxury" });
  });

  it("sends the chosen pace", async () => {
    renderForm();
    expect(screen.getByRole("radio", { name: "AI decides" })).toBeChecked(); // the AI picks the pace unless the user sets one
    await userEvent.click(screen.getByRole("radio", { name: "Calm" }));
    await userEvent.type(screen.getByLabelText("Project name"), "P");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ pace: "calm" });
  });

  it("keeps the main screen simple: the AI decides style and pace, the rest is under Advanced", async () => {
    renderForm();
    expect(screen.getByRole("radio", { name: /^Auto/ })).toBeChecked(); // style: the AI decides
    const advanced = screen.getByText(/^Advanced/).closest("details") as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    for (const label of ["Template", "Audio mode", "Language", "Editing pace", "Video style"]) {
      expect(advanced.contains(screen.getByLabelText(label))).toBe(true);
    }
    for (const label of ["Project name", "Brand", "Instructions for the AI"]) {
      expect(advanced.contains(screen.getByLabelText(label))).toBe(false);
    }
    await userEvent.click(screen.getByRole("button", { name: "+ Lots of close-ups of the details." }));
    await userEvent.click(screen.getByRole("button", { name: "+ End on the full look." }));
    expect(screen.getByLabelText("Instructions for the AI")).toHaveValue("Lots of close-ups of the details. End on the full look.");
  });

  it("offers the learned trends to edit like, the AI picking one by default", async () => {
    api.references.mockResolvedValue([{ id: "t1", name: "Luxury Oct", notes: "", profile: { seconds: 20 }, videos: [], createdAt: "", updatedAt: "" }]);
    renderForm();
    const pick = await screen.findByLabelText("Edit like");
    expect(pick).toHaveValue("auto");
    await userEvent.selectOptions(pick, "t1");
    await userEvent.type(screen.getByLabelText("Project name"), "P");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ reference: "t1" });
  });

  it("does not show the trend choice before any trend is learned", async () => {
    renderForm();
    await waitFor(() => expect(api.references).toHaveBeenCalled());
    expect(screen.queryByLabelText("Edit like")).not.toBeInTheDocument();
  });

  it("rejects unsupported file types with a message", () => {
    renderForm();
    addFiles(VIDEO_INPUT, [new File(["x"], "virus.exe")]);
    expect(screen.getByRole("alert")).toHaveTextContent("virus.exe");
  });

  it("shows the backend error and resumes without duplicating the project", async () => {
    api.uploadVideos.mockRejectedValueOnce(new ApiError(413, { code: "FILE_TOO_LARGE", message: "File exceeds the 500 MB limit." }));
    renderForm();
    await userEvent.type(screen.getByLabelText("Project name"), "Big");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3")]);
    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("File exceeds the 500 MB limit.");
    expect(screen.getByRole("alert")).toHaveTextContent("FILE_TOO_LARGE");
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Generate Reel" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject).toHaveBeenCalledTimes(1); // resumed, not re-created
  });

  it("removing a clip updates the list", async () => {
    renderForm();
    addFiles(VIDEO_INPUT, [video("a.mp4"), video("b.mp4")]);
    await userEvent.click(screen.getByRole("button", { name: "Remove a.mp4" }));
    expect(screen.queryByText(/a\.mp4/)).not.toBeInTheDocument();
    expect(screen.getByText(/b\.mp4/)).toBeInTheDocument();
  });
});
