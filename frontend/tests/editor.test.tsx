import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CaptionsPanel, MusicControls } from "@/components/editor/AudioCaptionsPanel";
import { Inspector } from "@/components/editor/Inspector";
import { QualityPanel } from "@/components/editor/QualityPanel";
import { TimelineTracks } from "@/components/editor/TimelineTracks";
import { op } from "@/lib/ops";
import type { EdlSegment, EdlTimeline, Media, QualityReport } from "@/types/api";

const seg = (over: Partial<EdlSegment> = {}): EdlSegment => ({
  id: "s1", clipId: "c1", video: "clip_a.mp4", sourceStart: 1, sourceEnd: 3, timelineStart: 0, timelineEnd: 2,
  speed: 1, effect: "none", transitionIn: { type: "cut", duration: 0 }, crop: { framing: "auto", focusX: null, focusY: null }, ...over,
});

const timeline = (over: Partial<EdlTimeline> = {}): EdlTimeline => ({
  duration: 10, bpm: 120, audioStart: 0, style: "cinematic", captionStyle: "minimal", musicVolume: 1, musicFadeIn: null, musicFadeOut: null,
  warnings: [], notes: [],
  segments: [
    seg({ id: "s1", timelineStart: 0, timelineEnd: 2 }),
    seg({ id: "s2", clipId: "c2", video: "clip_b.mp4", timelineStart: 2, timelineEnd: 6, effect: "zoom_in", transitionIn: { type: "dissolve", duration: 0.4 }, speed: 0.5 }),
    seg({ id: "s3", timelineStart: 6, timelineEnd: 10 }),
  ],
  captions: [{ id: "k1", start: 1, end: 3, text: "Hello world" }],
  ...over,
});

const clips = [
  { id: "c1", name: "clip_a.mp4" },
  { id: "c2", name: "clip_b.mp4" },
] as Media[];

describe("op builders (wire format)", () => {
  it("uses the server's operation names and camelCase fields", () => {
    expect(op.split("a", 1.5)).toEqual({ type: "split", segmentId: "a", at: 1.5 });
    expect(op.speed("a", 0.5)).toEqual({ type: "set_speed", segmentId: "a", speed: 0.5 });
    expect(op.framing("a", "fit")).toEqual({ type: "set_crop", segmentId: "a", crop: { framing: "fit" } });
    expect(op.updateCaption("k", { text: "x" })).toEqual({ type: "update_caption", captionId: "k", text: "x" });
    expect(op.remove("a").type).toBe("delete");
    expect(op.setLength("a", 3.2)).toEqual({ type: "set_length", segmentId: "a", length: 3.2 });
    expect(op.music({ audioStart: 12 })).toEqual({ type: "set_music", audioStart: 12 });
  });
});

describe("TimelineTracks", () => {
  it("draws every shot at its exact proportional position", () => {
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} />);
    const shots = within(screen.getByRole("listbox", { name: "Video track" })).getAllByRole("option");
    expect(shots).toHaveLength(3);
    expect(shots[1]).toHaveStyle({ left: "20%", width: "40%" });
    expect(shots[2]).toHaveStyle({ left: "60%", width: "40%" });
    expect(shots[1]).toHaveAccessibleName(/Shot 2: clip_b.mp4, 4.0 seconds/);
  });

  it("selects and deselects a shot", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={onSelect} playhead={0} onSeek={() => {}} />);
    await userEvent.click(screen.getByRole("option", { name: /Shot 2/ }));
    expect(onSelect).toHaveBeenLastCalledWith("s2");
    rerender(<TimelineTracks timeline={timeline()} selectedId="s2" onSelect={onSelect} playhead={0} onSeek={() => {}} />);
    expect(screen.getByRole("option", { name: /Shot 2/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("option", { name: /Shot 2/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("shows effects, transitions, slow motion, music and captions on their tracks", () => {
    render(<TimelineTracks timeline={timeline({ musicVolume: 0.6 })} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} musicName="song.mp3" />);
    expect(screen.getByText("zoom in")).toBeInTheDocument();
    expect(screen.getByText("dissolve")).toBeInTheDocument();
    expect(screen.getByText("0.5x")).toBeInTheDocument();
    expect(screen.getByText(/song.mp3 · starts at 0.0s in the song · volume 60% · 120 BPM/)).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("places the playhead and seeks on click", () => {
    const onSeek = vi.fn();
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={5} onSeek={onSeek} />);
    expect(screen.getByTestId("playhead")).toHaveStyle({ left: "50%" });
    const music = screen.getByText(/♪/).closest("div")!.parentElement!;
    Object.defineProperty(music, "getBoundingClientRect", { value: () => ({ left: 0, width: 200, top: 0, height: 10, right: 200, bottom: 10 }) });
    fireEvent.click(music, { clientX: 100 });
    expect(onSeek).toHaveBeenCalledWith(5);
  });

  it("marks a cut that lands on a beat with a check, and one that misses with a warning", () => {
    const music = {
      bpm: 120,
      beats: [{ t: 0, level: 3, downbeat: true }, { t: 2.02, level: 2, downbeat: false }, { t: 4, level: 2, downbeat: false }],
      accents: [{ t: 8, strength: 0.3 }], // too weak to count
      bars: [], phrases: [], drops: [], pauses: [], energyCurve: [], notDetected: [],
    };
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} music={music} />);
    expect(screen.getByLabelText("Cut at 2.00s is on the beat")).toBeInTheDocument();
    expect(screen.getByLabelText(/Cut at 6\.00s is \d+ms off the beat/)).toBeInTheDocument();
  });

  it("clicking a beat (or a strong accent) jumps the playhead there exactly, not just to where the row was clicked", async () => {
    const onSeek = vi.fn();
    const music = {
      bpm: 120,
      beats: [{ t: 0, level: 3, downbeat: true }, { t: 2.02, level: 2, downbeat: false }],
      accents: [{ t: 8, strength: 0.9 }],
      bars: [], phrases: [], drops: [], pauses: [], energyCurve: [], notDetected: [],
    };
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={onSeek} music={music} />);
    await userEvent.click(screen.getByRole("button", { name: "Go to the beat at 2.02s" }));
    expect(onSeek).toHaveBeenLastCalledWith(2.02);
    await userEvent.click(screen.getByRole("button", { name: "Go to the strong accent at 8.00s" }));
    expect(onSeek).toHaveBeenLastCalledWith(8);
  });

  it("clicking elsewhere on the beat row still seeks proportionally, same as the other rows", () => {
    const onSeek = vi.fn();
    const music = { bpm: 120, beats: [{ t: 0, level: 1, downbeat: false }], accents: [], bars: [], phrases: [], drops: [], pauses: [], energyCurve: [], notDetected: [] };
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={onSeek} music={music} />);
    const row = screen.getByLabelText("Go to the beat at 0.00s").parentElement!;
    Object.defineProperty(row, "getBoundingClientRect", { value: () => ({ left: 0, width: 200, top: 0, height: 24, right: 200, bottom: 24 }) });
    fireEvent.click(row, { clientX: 100 });
    expect(onSeek).toHaveBeenCalledWith(5);
  });

  it("shows a stale note when the beat map is from an earlier edit", () => {
    const music = { bpm: 120, beats: [{ t: 0, level: 1, downbeat: false }], accents: [], bars: [], phrases: [], drops: [], pauses: [], energyCurve: [], notDetected: [] };
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} music={music} musicStale />);
    expect(screen.getByText(/earlier version of the edit/)).toBeInTheDocument();
  });

  it("shows nothing extra when no beat map is passed, so the existing editor page looks exactly as before", () => {
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} />);
    expect(screen.queryByText(/beat map/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Beat")).not.toBeInTheDocument();
  });

  it("without `interactive`, has no zoom/gesture hint, no trim handles and no music-nudge buttons", () => {
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} onEdit={() => {}} />);
    expect(screen.queryByText(/pinch or Ctrl/)).not.toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Move music" })).not.toBeInTheDocument();
    // no zoom buttons at all, by design — gesture only
    expect(screen.queryByRole("button", { name: /zoom/i })).not.toBeInTheDocument();
  });

  it("with `interactive` but no onEdit, shows the gesture hint but no drag handles or music buttons (nothing to save to)", () => {
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} interactive />);
    expect(screen.getByText(/100% · pinch or Ctrl/)).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Move music" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /zoom/i })).not.toBeInTheDocument();
  });

  it("Ctrl+scroll (and, the same event, a trackpad pinch) zooms the timeline smoothly, with no button", async () => {
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} interactive />);
    const container = screen.getByLabelText("Timeline");
    expect(screen.getByText(/^100% /)).toBeInTheDocument();
    fireEvent.wheel(container, { deltaY: -100, ctrlKey: true });
    expect(screen.getByText(/^2\d\d% /)).toBeInTheDocument(); // zoomed in
    fireEvent.wheel(container, { deltaY: 100, ctrlKey: true });
    expect(screen.getByText(/^1\d\d% /)).toBeInTheDocument(); // back down
  });

  it("a plain two-finger scroll (no Ctrl key) does not zoom — only pinch/Ctrl+scroll does", () => {
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} interactive />);
    fireEvent.wheel(screen.getByLabelText("Timeline"), { deltaY: -100, ctrlKey: false });
    expect(screen.getByText(/^100% /)).toBeInTheDocument();
  });

  it("the left/right arrow keys nudge the playhead by a frame, and Shift+arrow by a second", () => {
    const onSeek = vi.fn();
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={5} onSeek={onSeek} interactive />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenLastCalledWith(5 + 1 / 30);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenLastCalledWith(5 - 1 / 30);
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    expect(onSeek).toHaveBeenLastCalledWith(6);
    onSeek.mockClear();
    fireEvent.keyDown(window, { key: "a" }); // any other key is ignored
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("arrow keys do nothing without `interactive`, and never jump outside the Reel", () => {
    const onSeek = vi.fn();
    const { rerender } = render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={onSeek} />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onSeek).not.toHaveBeenCalled();
    rerender(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={onSeek} interactive />);
    fireEvent.keyDown(window, { key: "ArrowLeft" }); // already at 0
    expect(onSeek).toHaveBeenLastCalledWith(0);
    rerender(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={10} onSeek={onSeek} interactive />);
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true }); // already at the end (duration 10)
    expect(onSeek).toHaveBeenLastCalledWith(10);
  });

  it("dragging a shot's trim handle reports a longer length once released, and ignores a barely-there drag", async () => {
    const onEdit = vi.fn();
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} interactive onEdit={onEdit} />);
    const track = screen.getByRole("listbox", { name: "Video track" });
    Object.defineProperty(track, "getBoundingClientRect", { value: () => ({ left: 0, width: 1000, top: 0, height: 48, right: 1000, bottom: 48 }) });
    const handle = within(screen.getByRole("option", { name: /Shot 1/ })).getByRole("slider"); // shot 1: 2s long, 0-10s total => 100px/s

    fireEvent.pointerDown(handle, { clientX: 200 });
    fireEvent.pointerMove(window, { clientX: 300 }); // +100px = +1s -> preview 3s
    fireEvent.pointerUp(window, { clientX: 300 });
    expect(onEdit).toHaveBeenCalledWith([op.setLength("s1", 3)], "Trim shot");

    onEdit.mockClear();
    fireEvent.pointerDown(handle, { clientX: 200 });
    fireEvent.pointerMove(window, { clientX: 202 }); // 0.02s: below the 0.05s commit threshold
    fireEvent.pointerUp(window, { clientX: 202 });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("a trim never previews shorter than the minimum shot length", async () => {
    const onEdit = vi.fn();
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} interactive onEdit={onEdit} />);
    const track = screen.getByRole("listbox", { name: "Video track" });
    Object.defineProperty(track, "getBoundingClientRect", { value: () => ({ left: 0, width: 1000, top: 0, height: 48, right: 1000, bottom: 48 }) });
    const handle = within(screen.getByRole("option", { name: /Shot 1/ })).getByRole("slider");

    fireEvent.pointerDown(handle, { clientX: 200 });
    fireEvent.pointerMove(window, { clientX: -5000 }); // a huge drag left
    fireEvent.pointerUp(window, { clientX: -5000 });
    expect(onEdit).toHaveBeenCalledWith([op.setLength("s1", 0.25)], "Trim shot");
  });

  it("nudges where the music starts, and cannot go below 0", async () => {
    const onEdit = vi.fn();
    render(<TimelineTracks timeline={timeline({ audioStart: 0.2 })} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} interactive onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: "Start the song 0.5s later" }));
    expect(onEdit).toHaveBeenLastCalledWith([op.music({ audioStart: 0.7 })], "Shift music");
    await userEvent.click(screen.getByRole("button", { name: "Start the song 0.5s earlier" }));
    expect(onEdit).toHaveBeenLastCalledWith([op.music({ audioStart: 0 })], "Shift music"); // 0.2 - 0.5, clamped

    onEdit.mockClear();
    render(<TimelineTracks timeline={timeline({ audioStart: 0 })} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} interactive onEdit={onEdit} />);
    expect(screen.getAllByRole("button", { name: "Start the song 0.5s earlier" })[1]).toBeDisabled();
  });

  it("disables editing controls while a save is in flight", () => {
    render(<TimelineTracks timeline={timeline()} selectedId={null} onSelect={() => {}} playhead={0} onSeek={() => {}} interactive onEdit={() => {}} busy />);
    expect(screen.getByRole("button", { name: "Start the song 0.5s later" })).toBeDisabled();
  });
});

describe("Inspector", () => {
  const setup = (s = seg(), index = 1) => {
    const onEdit = vi.fn();
    render(<Inspector segment={s} index={index} clips={clips} busy={false} onEdit={onEdit} />);
    return onEdit;
  };

  it("changes speed, effect, framing and clip with validated operations", async () => {
    const onEdit = setup();
    await userEvent.selectOptions(screen.getByLabelText("Speed"), "0.5");
    expect(onEdit).toHaveBeenLastCalledWith([op.speed("s1", 0.5)]);
    await userEvent.selectOptions(screen.getByLabelText("Effect"), "punch");
    expect(onEdit).toHaveBeenLastCalledWith([op.effect("s1", "punch")]);
    await userEvent.selectOptions(screen.getByLabelText("Framing"), "fit");
    expect(onEdit).toHaveBeenLastCalledWith([op.framing("s1", "fit")]);
    await userEvent.selectOptions(screen.getByLabelText("Replace with another clip"), "c2");
    expect(onEdit).toHaveBeenLastCalledWith([op.replace("s1", "c2")], "Replace clip");
  });

  it("changes the transition, but never for the first shot", async () => {
    const onEdit = setup(seg(), 1);
    await userEvent.selectOptions(screen.getByLabelText("Transition in"), "fade");
    expect(onEdit).toHaveBeenLastCalledWith([op.transition("s1", "fade", 0.3)]);
    document.body.innerHTML = "";
    setup(seg(), 0);
    expect(screen.getByLabelText("Transition in")).toBeDisabled();
  });

  it("offers the full transition catalogue with clean multi-word labels", async () => {
    const onEdit = setup(seg(), 1);
    const select = screen.getByLabelText("Transition in") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels.length).toBeGreaterThanOrEqual(50); // the expanded, paid-app-style catalogue
    expect(labels).toContain("wipe left");
    expect(labels).toContain("slice h left"); // two underscores: pretty() must replace every one, not just the first
    await userEvent.selectOptions(select, "pixelize");
    expect(onEdit).toHaveBeenLastCalledWith([op.transition("s1", "pixelize", 0.3)]);
  });

  it("applies a trim from the two source fields", async () => {
    const onEdit = setup();
    const a = screen.getByLabelText("Source start");
    await userEvent.clear(a);
    await userEvent.type(a, "1.5");
    await userEvent.click(screen.getByRole("button", { name: "Apply trim" }));
    expect(onEdit).toHaveBeenLastCalledWith([op.trim("s1", 1.5, 3)], "Trim shot");
  });

  it("locks every control while an edit is being saved", () => {
    render(<Inspector segment={seg()} index={1} clips={clips} busy onEdit={() => {}} />);
    expect(screen.getByLabelText("Speed")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply trim" })).toBeDisabled();
  });
});

describe("Captions and music", () => {
  it("adds a caption at the playhead, edits its text and deletes it", async () => {
    const onEdit = vi.fn();
    render(<CaptionsPanel timeline={timeline()} playhead={4} busy={false} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: "Add at playhead" }));
    expect(onEdit).toHaveBeenLastCalledWith([op.addCaption(4, 6, "New caption")], "Add caption");

    const text = screen.getByLabelText("Caption text");
    await userEvent.clear(text);
    await userEvent.type(text, "Fresh words");
    fireEvent.blur(text);
    expect(onEdit).toHaveBeenLastCalledWith([op.updateCaption("k1", { text: "Fresh words" })], "Edit caption");

    await userEvent.click(screen.getByRole("button", { name: /Delete caption Hello world/ }));
    expect(onEdit).toHaveBeenLastCalledWith([op.deleteCaption("k1")], "Delete caption");
    await userEvent.selectOptions(screen.getByLabelText("Caption style"), "karaoke");
    expect(onEdit).toHaveBeenLastCalledWith([op.captionStyle("karaoke")]);
  });

  it("does not save an unchanged caption or an empty one", () => {
    const onEdit = vi.fn();
    render(<CaptionsPanel timeline={timeline()} playhead={0} busy={false} onEdit={onEdit} />);
    const text = screen.getByLabelText("Caption text");
    fireEvent.blur(text);
    fireEvent.change(text, { target: { value: "   " } });
    fireEvent.blur(text);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("commits music volume when the slider is released and the fade-out on blur", () => {
    const onEdit = vi.fn();
    render(<MusicControls timeline={timeline()} busy={false} onEdit={onEdit} />);
    const slider = screen.getByLabelText("Music volume");
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(onEdit).not.toHaveBeenCalled(); // dragging alone does not spam the server
    fireEvent.pointerUp(slider);
    expect(onEdit).toHaveBeenLastCalledWith([op.music({ volume: 0.5 })], "Music volume");
    const fade = screen.getByLabelText("Fade-out");
    fireEvent.change(fade, { target: { value: "2" } });
    fireEvent.blur(fade);
    expect(onEdit).toHaveBeenLastCalledWith([op.music({ fadeOut: 2 })], "Music fade-out");
  });
});

describe("QualityPanel", () => {
  const report = (issues: QualityReport["issues"], rendering: string | null = null): QualityReport => ({
    ok: true, issues, checked: { timelineVersion: 2, renderingId: rendering, kind: rendering ? "preview" : null },
  });

  it("offers a check, lists issues and an Auto Fix that names the action", async () => {
    const onFix = vi.fn();
    const onCheck = vi.fn();
    render(
      <QualityPanel
        report={report([
          { code: "DURATION_MISMATCH", severity: "warning", message: "The Reel is 6.0s but the target is 8s.", fix: "Adjust shots to 8s", segmentId: null },
          { code: "BLACK_FRAMES", severity: "warning", message: "Black frames from 1.0s to 1.5s.", fix: null, segmentId: null },
        ])}
        checking={false} fixing={null} onCheck={onCheck} onFix={onFix}
      />,
    );
    expect(screen.getByText(/target is 8s/)).toBeInTheDocument();
    expect(screen.getByText("needs your review")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Auto Fix: Adjust shots to 8s" }));
    expect(onFix).toHaveBeenCalledWith("DURATION_MISMATCH", null);
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onCheck).toHaveBeenCalled();
  });

  it("confirms a clean result and says what was (not) checked", () => {
    const { rerender } = render(<QualityPanel report={report([])} checking={false} fixing={null} onCheck={() => {}} onFix={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("No problems found in the timeline");
    expect(screen.getByText(/Render a preview to also check/)).toBeInTheDocument();
    rerender(<QualityPanel report={report([], "r1")} checking={false} fixing={null} onCheck={() => {}} onFix={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("preview render and the timeline");
  });

  it("disables fixes while one is running", () => {
    render(
      <QualityPanel
        report={report([{ code: "AUDIO_CLIPPING", severity: "warning", message: "clips", fix: "Lower music volume", segmentId: null }])}
        checking={false} fixing="AUDIO_CLIPPING" onCheck={() => {}} onFix={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Fixing…" })).toBeDisabled();
  });
});

