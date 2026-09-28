import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dropzone } from "@/components/Dropzone";
import { ProgressStages } from "@/components/ProgressStages";
import { ReelPreview } from "@/components/ReelPreview";
import { DurationSelector, StyleSelector } from "@/components/StyleSelector";
import { StatusBadge } from "@/components/ui";
import { VideoList } from "@/components/VideoList";
import type { Job, Rendering } from "@/types/api";

const file = (name: string) => new File(["x"], name, { type: "video/mp4" });

describe("StyleSelector / DurationSelector", () => {
  it("selects a style", async () => {
    const onChange = vi.fn();
    render(<StyleSelector value="fast_trending" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /Fast Trending/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /Luxury/ }));
    expect(onChange).toHaveBeenCalledWith("luxury");
  });
  it("offers 15/30/60 second durations and a custom length", async () => {
    const onChange = vi.fn();
    render(<DurationSelector value={15} onChange={onChange} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["15s", "30s", "60s", "Custom"]);
    await userEvent.click(screen.getByRole("radio", { name: "30s" }));
    expect(onChange).toHaveBeenCalledWith(30);
  });
});

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

describe("VideoList", () => {
  const items = [
    { key: "1", file: file("one.mp4") },
    { key: "2", file: file("two.mp4") },
  ];
  it("reorders and removes", async () => {
    const onChange = vi.fn();
    render(<VideoList items={items} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Move one.mp4 down" }));
    expect(onChange.mock.calls[0][0].map((i: { key: string }) => i.key)).toEqual(["2", "1"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove two.mp4" }));
    expect(onChange.mock.calls[1][0].map((i: { key: string }) => i.key)).toEqual(["1"]);
  });
  it("disables impossible moves", () => {
    render(<VideoList items={items} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Move one.mp4 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move two.mp4 down" })).toBeDisabled();
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
    expect(screen.getByText(/Analyzing videos/)).toHaveTextContent("✓");
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

describe("ReelPreview", () => {
  const r: Rendering = {
    id: "r1", projectId: "p", style: "luxury", duration: 15, width: 1080, height: 1920, size: 5 * 1024 * 1024,
    label: "", createdAt: "", url: "/api/x/file", downloadUrl: "/api/x/file?download=1", postCopy: null,
  };
  it("shows real metadata and a download link", () => {
    render(<ReelPreview rendering={r} currentStyle="luxury" currentDuration={15} versionCount={1} busy={false} onGenerate={() => {}} />);
    expect(screen.getByText("1080×1920")).toBeInTheDocument();
    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
    expect(screen.getByText("0:15")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", expect.stringContaining("download=1"));
  });
  it("regenerates, changes style/duration and creates versions", async () => {
    const onGenerate = vi.fn();
    render(<ReelPreview rendering={r} currentStyle="luxury" currentDuration={15} versionCount={2} busy={false} onGenerate={onGenerate} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onGenerate).toHaveBeenLastCalledWith({ seed: expect.any(Number) });
    await userEvent.click(screen.getByRole("button", { name: "Create another version" }));
    expect(onGenerate).toHaveBeenLastCalledWith({ seed: expect.any(Number), label: "Version 3" });
    await userEvent.click(screen.getByRole("button", { name: "Change style" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Video style" })).getByRole("radio", { name: /Cinematic/ }));
    await userEvent.click(screen.getByRole("button", { name: /Re-render in Cinematic/ }));
    expect(onGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ style: "cinematic" }));
    await userEvent.click(screen.getByRole("button", { name: "Change duration" }));
    await userEvent.click(screen.getByRole("radio", { name: "30s" }));
    await userEvent.click(screen.getByRole("button", { name: /Re-render at 30s/ }));
    expect(onGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 30 }));
  });
  it("re-renders with a different pace", async () => {
    const onGenerate = vi.fn();
    render(<ReelPreview rendering={r} currentStyle="luxury" currentDuration={15} versionCount={1} busy={false} onGenerate={onGenerate} />);
    await userEvent.click(screen.getByRole("button", { name: "Change pace" }));
    await userEvent.click(screen.getByRole("radio", { name: "Calm" }));
    await userEvent.click(screen.getByRole("button", { name: /Re-render with calm pace/ }));
    expect(onGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ pace: "calm" }));
  });
  it("disables actions while busy", () => {
    render(<ReelPreview rendering={r} currentStyle="luxury" currentDuration={15} versionCount={1} busy onGenerate={() => {}} />);
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
  });
});
