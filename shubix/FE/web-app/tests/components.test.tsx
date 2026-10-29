import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dropzone } from "@/components/molecules/Dropzone";
import { StatusBadge } from "@/components/atoms";

vi.mock("@/hooks/useApi", async () => {
  const { defaultText } = await import("./helpers/texts");
  return { useText: () => defaultText };
});

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
