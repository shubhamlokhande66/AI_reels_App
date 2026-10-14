import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ id: "p1" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const api = vi.hoisted(() => ({ getProject: vi.fn(), cancelJob: vi.fn(), renderings: vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import ProjectPage from "@/app/projects/[id]/page";
import type { Job, Project } from "@/types/api";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectPage />
    </QueryClientProvider>,
  );
}

const job: Job = {
  id: "j1", projectId: "p1", type: "generate", status: "processing", progress: 40, stage: "rendering",
  error: null, renderingId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  stages: [{ name: "rendering", label: "Rendering video", status: "running", progress: 40 }],
};

const project: Project = {
  id: "p1", name: "My Reel", status: "processing",
  settings: { duration: 15, style: "fast_trending", pace: "balanced", teaser: true, stepLabels: true, orderMode: "auto",
    captions: false, captionStyle: "minimal", ai: false, audioMode: "music", language: "en", exportPreset: "instagram_reel" } as Project["settings"],
  videos: [], audio: null, analysis: null, timeline: null, output: null, latestJob: job, error: null,
} as unknown as Project;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Project page — cancelling a running job", () => {
  it("shows a Cancel button while processing and calls the cancel endpoint", async () => {
    api.getProject.mockResolvedValue(project);
    api.cancelJob.mockResolvedValue({ ...job, status: "processing" });
    renderPage();

    expect(await screen.findByText("Creating your Reel…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancelJob).toHaveBeenCalledWith("p1", "j1"));
  });

  it("shows an error if cancelling fails, without crashing the page", async () => {
    api.getProject.mockResolvedValue(project);
    api.cancelJob.mockRejectedValue(new Error("This job has already finished, so there is nothing to cancel."));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("This job has already finished, so there is nothing to cancel.")).toBeInTheDocument();
  });

  it("has no Cancel button once the project is no longer processing", async () => {
    api.getProject.mockResolvedValue({ ...project, status: "draft", latestJob: null });
    renderPage();

    await waitFor(() => expect(screen.queryByText("Creating your Reel…")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
  });
});
