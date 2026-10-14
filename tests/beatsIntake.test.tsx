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

import NewBeatSyncPage from "@/app/beats/new/page";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NewBeatSyncPage />
    </QueryClientProvider>,
  );
}

const addFiles = (selector: string, files: File[]) => fireEvent.change(document.querySelector(selector) as HTMLInputElement, { target: { files } });
const video = (n: string) => new File(["v"], n, { type: "video/mp4" });
const song = () => new File(["a"], "song.mp3", { type: "audio/mpeg" });
const VIDEO_INPUT = "input[accept*='.mp4']";
const AUDIO_INPUT = "input[accept*='.mp3']";

beforeEach(() => {
  vi.clearAllMocks();
  api.createProject.mockResolvedValue({ id: "p1" });
  api.uploadVideos.mockResolvedValue({ uploaded: [{ id: "v1" }], failed: [] });
  api.uploadAudio.mockResolvedValue({});
  api.generate.mockResolvedValue({ id: "j1" });
});

describe("Check the beat sync (standalone entry point)", () => {
  it("cannot submit without a clip and a song", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Check the beat sync" })).toBeDisabled();
  });

  it("creates a fast, non-AI, mixed-order project, uploads video then song, generates, and goes straight to the beat-sync page", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Name/), "My test");
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.click(screen.getByRole("button", { name: "Check the beat sync" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1/beats"));
    expect(api.createProject).toHaveBeenCalledWith("My test", { duration: 30, style: "fast_trending", pace: "balanced", sequence: "mixed", ai: false });
    expect(api.uploadVideos.mock.calls[0][0]).toBe("p1");
    expect(api.uploadAudio.mock.calls[0][0]).toBe("p1");
    expect(api.uploadAudio.mock.calls[0][1].name).toBe("song.mp3");
    expect(api.generate).toHaveBeenCalledWith("p1", { label: "Beat sync check" });
  });

  it("lets you choose the cut rhythm: every beat (fast) or fewer, strong-beat cuts (calm)", async () => {
    renderPage();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.click(screen.getByRole("radio", { name: "Calm" }));
    await userEvent.click(screen.getByRole("button", { name: "Check the beat sync" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ pace: "calm" });
  });

  it("lets you choose the length and which part of the song to use", async () => {
    renderPage();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    await userEvent.click(screen.getByRole("radio", { name: "60s" }));
    addFiles(AUDIO_INPUT, [song()]);
    // the picker appears once a song is chosen; the user takes control of the start
    await userEvent.click(await screen.findByRole("checkbox", { name: /Let the app choose/ }));
    const start = screen.getByLabelText("Start time");
    await userEvent.clear(start);
    await userEvent.type(start, "0:30");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "Check the beat sync" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).toMatchObject({ duration: 60, audioStart: 30 });
  });

  it("defaults to the app choosing the best part of the song when left alone", async () => {
    renderPage();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.click(screen.getByRole("button", { name: "Check the beat sync" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][1]).not.toHaveProperty("audioStart");
  });

  it("defaults the name when left blank", async () => {
    renderPage();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.click(screen.getByRole("button", { name: "Check the beat sync" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith("Beat sync check", expect.anything()));
  });

  it("shows the upload error and lets you try again, without navigating away", async () => {
    api.uploadVideos.mockResolvedValue({ uploaded: [], failed: [{ name: "a.mp4", error: { message: "bad file" } }] });
    renderPage();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    addFiles(AUDIO_INPUT, [song()]);
    await userEvent.click(screen.getByRole("button", { name: "Check the beat sync" }));
    await screen.findByText(/None of the video clips could be used/);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Check the beat sync" })).not.toBeDisabled();
  });
});
