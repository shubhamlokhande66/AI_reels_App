import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  references: vi.fn(),
  createReference: vi.fn(),
  addReferenceVideos: vi.fn(),
  updateReference: vi.fn(),
  removeReferenceVideo: vi.fn(),
  deleteReference: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import TrendsPage from "@/app/trends/page";

const TREND = {
  id: "t1", name: "Luxury Oct", notes: "slow zooms", createdAt: "", updatedAt: "",
  profile: { videos: 2, seconds: 40, pace: "balanced", avgShot: 1.6, hookSeconds: 0.9, onBeatShare: 0.85, bpm: 96, loudAvgShot: 1.1, calmAvgShot: 2.4,
             look: { brightness: 0.7, saturation: 0.5 }, described: [{ summary: "Close-ups with quick zooms on the beat.", effects: ["zoom"] }] },
  videos: [{ name: "a.mp4", seconds: 20, shots: 12, avgShot: 1.6 }, { name: "b.mp4", seconds: 20, shots: 13, avgShot: 1.5 }],
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TrendsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.references.mockResolvedValue([TREND]);
  api.createReference.mockResolvedValue(TREND);
});

describe("My trends", () => {
  it("shows what was learned in plain words", async () => {
    renderPage();
    const facts = await screen.findByRole("list", { name: "What Luxury Oct does" });
    expect(facts).toHaveTextContent("A cut every 1.6s on average (balanced pace)");
    expect(facts).toHaveTextContent("85% of cuts land on the beat (96 BPM)");
    expect(facts).toHaveTextContent("Loud parts 1.1s per shot, calm parts 2.4s");
    expect(facts).toHaveTextContent("Look: bright, vivid colour");
    expect(screen.getByText(/Close-ups with quick zooms on the beat/)).toBeInTheDocument();
    expect(screen.getByText(/Learned from 2 Reels/)).toBeInTheDocument();
  });

  it("learns a new trend from uploaded Reels", async () => {
    renderPage();
    const btn = screen.getByRole("button", { name: "Learn this trend" });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Trend name"), "Party");
    fireEvent.change(document.querySelector("input[type=file]") as HTMLInputElement, {
      target: { files: [new File(["v"], "reel.mp4", { type: "video/mp4" })] },
    });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    await waitFor(() => expect(api.createReference).toHaveBeenCalled());
    expect(api.createReference.mock.calls[0].slice(0, 2)).toEqual(["Party", ""]);
    expect(api.createReference.mock.calls[0][2].map((f: File) => f.name)).toEqual(["reel.mp4"]);
  });
});
