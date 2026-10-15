import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

/** The create flow, step by step as a person goes through it: 1 music, 2 length, 3 clips (uploaded and checked
 * straight away), 4 style and generate. The charts and pickers inside the steps have their own tests. */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));

const admin = vi.hoisted(() => ({ value: true }));
vi.mock("@/hooks/useApi", () => ({
  useAdmin: () => ({ admin: admin.value, required: false, loading: false }),
  useTrends: () => ({ data: [] }),
}));
vi.mock("@/components/organisms/BeatMap", () => ({ BeatMap: () => <div>beat map</div>, PlanTable: () => <div>cut plan</div> }));
vi.mock("@/components/organisms/SongAnalysis", () => ({ SongAnalysis: () => <div>song analysis</div> }));
vi.mock("@/components/molecules/SongPartPicker", () => ({ SongPartPicker: () => <div>song part picker</div> }));
vi.mock("@/components/organisms/Songs", () => ({ SongPicker: () => null }));
vi.mock("@/components/organisms/ReferenceReel", () => ({ ReferencePicker: () => null, ReferenceReel: () => null, ReferenceStatus: () => null }));

const api = vi.hoisted(() => ({
  createProject: vi.fn(), updateProject: vi.fn(), getProject: vi.fn(), uploadVideos: vi.fn(), uploadAudio: vi.fn(), deleteVideo: vi.fn(),
  analyze: vi.fn(), getJob: vi.fn(), generate: vi.fn(), beatMap: vi.fn(), songAnalysis: vi.fn(), songParts: vi.fn(), beatPlan: vi.fn(),
  templates: vi.fn(), brands: vi.fn(), references: vi.fn(), applyTemplate: vi.fn(), applyBrand: vi.fn(), setReferenceReel: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import { CreateReelForm } from "@/components/organisms/CreateReelForm";

const VIDEO_INPUT = "input[accept*='.mp4']";
const AUDIO_INPUT = "input[accept*='.mp3']";
const addFiles = (selector: string, files: File[]) =>
  fireEvent.change(document.querySelector(selector) as HTMLInputElement, { target: { files } });
const video = (n: string) => new File(["v"], n, { type: "video/mp4" });

/** A clip as the server returns it after the check (good = usable, with that many good seconds). */
const clip = (id: string, good = 12, usable = true) => ({
  id, name: `${id}.mp4`, duration: 12, purged: false, thumbnailUrl: null,
  analysis: { usable, goodSeconds: usable ? good : 0, qualityScore: usable ? 0.9 : 0.1, flags: usable ? [] : ["too_dark"] },
});
const projectWith = (...videos: ReturnType<typeof clip>[]) => ({ id: "p1", name: "Untitled Reel", videos, analysis: null });

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CreateReelForm />
    </QueryClientProvider>,
  );
}

/** Step 1 without a song, step 2 at the default length: the clips step. */
async function toClipsWithoutMusic() {
  await userEvent.click(screen.getByRole("button", { name: /Continue without music/ }));
  await userEvent.click(screen.getByRole("button", { name: "Next: your clips" }));
}

/** Adds clips; the check runs by itself and, when it passes, the form moves on to style and generate. */
async function addClipsAndPass(files: File[]) {
  addFiles(VIDEO_INPUT, files);
  await screen.findByRole("button", { name: /Generate Reel/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  admin.value = true;
  api.createProject.mockResolvedValue({ id: "p1" });
  api.updateProject.mockResolvedValue({ id: "p1" });
  api.uploadVideos.mockResolvedValue({ uploaded: [], failed: [] });
  api.getProject.mockResolvedValue(projectWith(clip("a"), clip("b")));
  api.analyze.mockResolvedValue({ id: "j1" });
  api.getJob.mockResolvedValue({ id: "j1", status: "completed", progress: 100, stages: [] });
  api.generate.mockResolvedValue({ id: "j2" });
  api.uploadAudio.mockResolvedValue({});
  api.beatMap.mockResolvedValue({ bpm: 120, counts: { major: 8, beat: 60, bars: 15, drops: 1, rises: 1, falls: 0 } });
  api.songAnalysis.mockResolvedValue({ status: "completed", tempo: { bpm: 120 }, beats: [], sections: [], candidate_events: [], errors: [] });
  api.songParts.mockResolvedValue({ bpm: 120, parts: [{ start: 42, end: 57, reasons: ["the chorus"] }] });
  api.beatPlan.mockResolvedValue({ start: 42, duration: 15, rows: [] });
  api.templates.mockResolvedValue([]);
  api.brands.mockResolvedValue([]);
  api.references.mockResolvedValue([]);
});

describe("CreateReelForm", { timeout: 30_000 }, () => {
  it("starts with the music, and opens the phone's music and video files", async () => {
    renderForm();
    expect(screen.getByText(/1 · Music/)).toBeInTheDocument();
    expect(document.querySelector(AUDIO_INPUT)?.getAttribute("accept")).toContain("audio/*");
    expect(screen.queryByRole("button", { name: /Generate Reel/ })).not.toBeInTheDocument();
    await toClipsWithoutMusic();
    expect(document.querySelector(VIDEO_INPUT)?.getAttribute("accept")).toContain("video/*");
  });

  it("uploads and checks the clips as soon as they are added, then generates the Reel with the clips' own sound", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/Project name/), "  My reel ");
    await toClipsWithoutMusic();
    await addClipsAndPass([video("a.mp4"), video("b.mov")]);

    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.createProject.mock.calls[0][0]).toBe("My reel");
    expect(api.uploadVideos.mock.calls[0][1].map((f: File) => f.name)).toEqual(["a.mp4", "b.mov"]); // in the order picked
    expect(api.analyze).toHaveBeenCalledWith("p1");

    await userEvent.click(screen.getByRole("button", { name: /Generate Reel/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    const settings = api.updateProject.mock.calls.at(-1)![1];
    expect(settings).toMatchObject({ name: "My reel", duration: 15, audioMode: "original", platform: "instagram", exportPreset: "instagram_reel" });
    expect(settings).not.toHaveProperty("audioStart"); // no song
    expect(api.createProject).toHaveBeenCalledTimes(1); // the project from the check is reused
    expect(api.uploadVideos).toHaveBeenCalledTimes(1); // and so are its clips
    expect(api.generate).toHaveBeenCalledWith("p1");
  });

  it("analyses the song when it is added, picks its best part, and plays the Reel from there", async () => {
    renderForm();
    addFiles(AUDIO_INPUT, [new File(["a"], "song.mp3", { type: "audio/mpeg" })]);
    await screen.findByText("beat map");
    expect(api.uploadAudio.mock.calls[0][1].name).toBe("song.mp3");
    expect(api.songParts).toHaveBeenCalledWith("p1", 15, 6);

    await userEvent.click(screen.getByRole("button", { name: "Next: Reel length" }));
    expect(screen.getByText("song part picker")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Where should cuts land?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next: your clips" }));
    await addClipsAndPass([video("a.mp4")]);
    await userEvent.click(screen.getByRole("button", { name: /Generate Reel/ }));

    await waitFor(() => expect(api.generate).toHaveBeenCalledWith("p1"));
    expect(api.updateProject.mock.calls.at(-1)![1]).toMatchObject({ audioMode: "music", audioStart: 42, beatPlan: true, cutEveryBeat: false });
    expect(api.uploadAudio).toHaveBeenCalledTimes(1); // the song is not uploaded twice
  });

  it("stops on a clip that cannot be used, and goes on once it is removed", async () => {
    api.getProject.mockResolvedValue(projectWith(clip("good", 30), clip("dark", 0, false)));
    renderForm();
    await toClipsWithoutMusic();
    addFiles(VIDEO_INPUT, [video("good.mp4"), video("dark.mp4")]);
    await userEvent.click(await screen.findByRole("button", { name: "Review" })); // the check's popup, then the result under it
    const panel = await screen.findByRole("list", { name: "Checked clips" });
    expect(screen.queryByRole("button", { name: /Generate Reel/ })).not.toBeInTheDocument();

    api.getProject.mockResolvedValue(projectWith(clip("good", 30)));
    await userEvent.click(within(panel).getByRole("button", { name: "Remove" }));
    expect(api.deleteVideo).toHaveBeenCalledWith("p1", "dark");
    await screen.findByRole("button", { name: /Generate Reel/ });
  });

  it("says how much footage is missing when the clips are too short for the Reel", async () => {
    api.getProject.mockResolvedValue(projectWith(clip("short", 4)));
    renderForm();
    await toClipsWithoutMusic();
    addFiles(VIDEO_INPUT, [video("short.mp4")]);
    expect(await screen.findByText(/more good footage is needed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate Reel/ })).not.toBeInTheDocument();
  });

  it("shows why the check stopped, and Retry carries on without a second project", async () => {
    api.analyze.mockRejectedValueOnce(new ApiError(503, { code: "SERVER_TIMEOUT", message: "The server did not answer in time." }));
    renderForm();
    await toClipsWithoutMusic();
    addFiles(VIDEO_INPUT, [video("a.mp4")]);
    expect((await screen.findAllByText("The server did not answer in time.")).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /Retry|Try again/ }));
    await screen.findByRole("button", { name: /Generate Reel/ });
    expect(api.createProject).toHaveBeenCalledTimes(1);
  });

  it("reports clips the server skipped, and keeps the others", async () => {
    api.uploadVideos.mockResolvedValue({ uploaded: [{ id: "a" }], failed: [{ name: "broken.mp4", error: { code: "CORRUPTED_MEDIA", message: "cannot be read" } }] });
    api.getProject.mockResolvedValue(projectWith(clip("a"), clip("b")));
    renderForm();
    await toClipsWithoutMusic();
    addFiles(VIDEO_INPUT, [video("a.mp4"), video("broken.mp4")]);
    expect(await screen.findByText(/Skipped broken\.mp4: cannot be read/)).toBeInTheDocument();
  });

  it("rejects files that are not videos, with a message", async () => {
    renderForm();
    await toClipsWithoutMusic();
    addFiles(VIDEO_INPUT, [new File(["x"], "notes.txt", { type: "text/plain" })]);
    expect(await screen.findByText(/Unsupported video file: notes\.txt/)).toBeInTheDocument();
    expect(api.uploadVideos).not.toHaveBeenCalled();
  });

  it("sends the creative direction, the instructions and the caption style", async () => {
    renderForm();
    await toClipsWithoutMusic();
    await addClipsAndPass([video("a.mp4")]);
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Creative direction" })).getByRole("radio", { name: /Cinematic/ }));
    await userEvent.click(screen.getByRole("button", { name: "+ Start with the best shot." }));
    await userEvent.click(screen.getByText(/More options/));
    await userEvent.click(screen.getByRole("switch", { name: /Captions/ }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Caption style" })).getByRole("radio", { name: "bold" }));
    await userEvent.click(screen.getByRole("button", { name: /Generate Reel/ }));

    await waitFor(() => expect(api.generate).toHaveBeenCalled());
    expect(api.updateProject.mock.calls.at(-1)![1]).toMatchObject({ concept: "cinematic", brief: "Start with the best shot.", captions: true, captionStyle: "bold" });
  });

  it("offers the learned trends to edit like (the AI picks one by default), only once there are some", async () => {
    api.references.mockResolvedValue([{ id: "t1", name: "Gold drop" }]);
    renderForm();
    await toClipsWithoutMusic();
    await addClipsAndPass([video("a.mp4")]);
    const select = await screen.findByRole("combobox", { name: "Edit like" });
    expect((select as HTMLSelectElement).value).toBe("auto");
    expect(within(select).getByRole("option", { name: "Gold drop" })).toBeInTheDocument();
  });

  it("does not show the trend choice before any trend is learned", async () => {
    renderForm();
    await toClipsWithoutMusic();
    await addClipsAndPass([video("a.mp4")]);
    expect(screen.queryByRole("combobox", { name: "Edit like" })).not.toBeInTheDocument();
  });

  it("shows a failed start and tries again without making another project or uploading again", async () => {
    api.generate.mockRejectedValueOnce(new ApiError(503, { code: "PROJECT_BUSY", message: "The project is being processed." }));
    renderForm();
    await toClipsWithoutMusic();
    await addClipsAndPass([video("a.mp4")]);
    await userEvent.click(screen.getByRole("button", { name: /Generate Reel/ }));
    expect(await screen.findByText("The project is being processed.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Generate Reel/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.uploadVideos).toHaveBeenCalledTimes(1);
  });
});
