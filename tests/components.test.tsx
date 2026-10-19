import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dropzone } from "@/components/molecules/Dropzone";
import { ProgressStages } from "@/components/molecules/ProgressStages";
import { StatusBadge } from "@/components/atoms";
import type { Job } from "@/types/api";

const file = (name: string) => new File(["x"], name, { type: "video/mp4" });

describe("Dropzone", () => {
  it("accepts valid files and reports rejected ones", () => {
    const onFiles = vi.fn();
    const onReject = vi.fn();
    render(
      <Dropzone label="Drop" hint="h" accept=".mp4" multiple validate={(f) => f.name.endsWith(".mp4")} onFiles={onFiles} onReject={onReject} />,
    );
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file("a.mp4"), file("virus.exe")] } });
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: "a.mp4" })]);
    expect(onReject).toHaveBeenCalledWith(["virus.exe"]);
  });
  it("handles drag and drop", () => {
    const onFiles = vi.fn();
    const { container } = render(<Dropzone label="Drop" hint="h" accept=".mp4" validate={() => true} onFiles={onFiles} />);
    fireEvent.drop(container.firstChild as Element, { dataTransfer: { files: [file("dropped.mp4")] } });
    expect(onFiles).toHaveBeenCalled();
  });
  it("ignores drops when disabled", () => {
    const onFiles = vi.fn();
    const { container } = render(<Dropzone label="Drop" hint="h" accept=".mp4" disabled validate={() => true} onFiles={onFiles} />);
    fireEvent.drop(container.firstChild as Element, { dataTransfer: { files: [file("x.mp4")] } });
    expect(onFiles).not.toHaveBeenCalled();
  });
});

describe("ProgressStages", () => {
  const job: Job = {
    id: "j", projectId: "p", type: "generate", status: "processing", progress: 62, stage: "rendering",
    error: null, renderingId: null, createdAt: "", updatedAt: "",
    stages: [
      { name: "analyzing_videos", label: "Analyzing videos", status: "completed", progress: 100 },
      { name: "rendering", label: "Rendering video", status: "running", progress: 40 },
      { name: "x", label: "Later", status: "pending", progress: 0 },
    ],
  };
  it("shows overall and per-stage progress", () => {
    render(<ProgressStages job={job} />);
    expect(screen.getByRole("progressbar", { name: "Overall progress" })).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByRole("progressbar", { name: "Rendering video" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("Analyzing videos").closest("li")).toHaveClass("done"); // its step is ticked
  });

  it("says where a waiting Reel is in line", () => {
    const { rerender } = render(<ProgressStages job={{ ...job, status: "queued", progress: 0, queuePosition: 3 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting in line: 2 Reels ahead of yours.");
    rerender(<ProgressStages job={{ ...job, status: "queued", progress: 0, queuePosition: 1 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Yours is next");
  });

  it("has no Cancel button when onCancel is not given", () => {
    render(<ProgressStages job={job} />);
    expect(screen.queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it("shows a working Cancel button while queued/processing", async () => {
    const onCancel = vi.fn();
    render(<ProgressStages job={job} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled 'Cancelling…' state", () => {
    render(<ProgressStages job={job} onCancel={() => {}} cancelling />);
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  });

  it("hides the Cancel button once the job is no longer active", () => {
    render(<ProgressStages job={{ ...job, status: "completed" }} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("renders each status", () => {
    render(
      <>
        <StatusBadge status="completed" />
        <StatusBadge status="failed" />
      </>,
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
