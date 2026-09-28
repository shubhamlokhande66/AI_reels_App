import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  songs: vi.fn(), songFile: vi.fn(), songUsed: vi.fn(), uploadSongs: vi.fn(), deleteSong: vi.fn(), importSongs: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import { SongPicker, SongsPage } from "@/components/Songs";
import type { Song } from "@/types/api";

const song = (over: Partial<Song> = {}): Song => ({
  id: "s1", name: "Ganpati Bappa", artist: null, duration: 185, size: 3_000_000, source: "folder", license: null, licenseUrl: null,
  shareUrl: null, image: null, url: "/api/songs/s1/file", useCount: 2, ...over,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.songs.mockResolvedValue({ songs: [song()], folders: ["C:\\Users\\me\\Downloads"] });
  api.songUsed.mockResolvedValue(undefined);
});

describe("Pick a song from the library (Create Reel)", () => {
  it("lists my songs and hands the chosen one back as a file", async () => {
    const file = new File(["x"], "Ganpati Bappa.mp3", { type: "audio/mpeg" });
    api.songFile.mockResolvedValue(file);
    const onPick = vi.fn();
    wrap(<SongPicker onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "♬ Pick from my songs" }));
    expect(await screen.findByText("Ganpati Bappa")).toBeInTheDocument();
    expect(screen.getByText(/3:05 · from folder/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(file));
    expect(api.songUsed).toHaveBeenCalledWith("s1");
  });
});

describe("Songs page", () => {
  it("shows the watched folder and deletes only after confirming", async () => {
    api.deleteSong.mockResolvedValue(undefined);
    wrap(<SongsPage />);
    expect(await screen.findByText(/Downloads are added automatically/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Ganpati Bappa" }));
    expect(api.deleteSong).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(api.deleteSong).toHaveBeenCalledWith("s1"));
  });
});
