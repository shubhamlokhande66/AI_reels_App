import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  uploadVideos: vi.fn(),
  uploadAudio: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import NewAiEditPage from "@/app/ai-edit/new/page";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NewAiEditPage />
    </QueryClientProvider>,
  );
}

const addFiles = (selector: string, files: File[]) => fireEvent.change(document.querySelector(selector) as HTMLInputElement, { target: { files } });
const video = (n: string) => new File(["v"], n, { type: "video/mp4" });
const song = () => new File(["a"], "song.mp3", { type: "audio/mpeg" });
const VIDEO_INPUT = "input[accept*='.mp4']";
const AUDIO_INPUT = "input[accept*='.mp3']";
const SUBMIT = "Create and edit with AI";

beforeEach(() => {
  vi.clearAllMocks();
  api.createProject.mockResolvedValue({ id: "p1" });
  api.uploadVideos.mockResolvedValue({ uploaded: [{ id: "v1" }], failed: [] });
  api.uploadAudio.mockResolvedValue({});
  api.generate.mockResolvedValue({ id: "j1" });
});

describe("AI Edit (standalone entry point: video + audio + a prompt)", () => {
  it("cannot submit without a clip and a song", () => {
    renderPage();
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
  });

  it("creates a fast, non-AI project, uploads video then song, generates, and hands the prompt to the project page via the URL", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Name/), "My reel");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.type(screen.getByLabelText("What should the AI do?"), "make it calmer and add captions");
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1?prompt=make%20it%20calmer%20and%20add%20captions"));
    expect(api.createProject).toHaveBeenCalledWith("My reel", { duration: 30, style: "fast_trending", sequence: "mixed", ai: false });
    expect(api.uploadVideos.mock.calls[0][0]).toBe("p1");
    expect(api.uploadAudio.mock.calls[0][0]).toBe("p1");
    expect(api.generate).toHaveBeenCalledWith("p1", { label: "AI edit" });
  });

  it("goes to the plain project page, with no prompt param, when the prompt is left empty", async () => {
    renderPage();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
  });

  it("adds an idea to the prompt box without wiping what is already typed", async () => {
    renderPage();
    const box = screen.getByLabelText("What should the AI do?");
    await userEvent.type(box, "make it 20 seconds");
    await userEvent.click(screen.getByRole("button", { name: "Louder music" }));
    expect(box).toHaveValue("make it 20 seconds, louder music");
  });

  it("lets you choose the length and which part of the song to use, same as Beat Sync", async () => {
    renderPage();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    await userEvent.click(screen.getByRole("radio", { name: "60s" }));
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Let the app choose/ }));
    const start = screen.getByLabelText("Start time");
    await userEvent.clear(start);
    await userEvent.type(start, "0:30");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ duration: 60, audioStart: 30 });
  });

  it("shows the upload error and lets you try again, without navigating away", async () => {
    api.uploadVideos.mockResolvedValue({ uploaded: [], failed: [{ name: "a.mp4", error: { message: "bad file" } }] });
    renderPage();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await screen.findByText(/None of the video clips could be used/);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: SUBMIT })).not.toBeDisabled();
  });
});
