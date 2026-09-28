import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const api = vi.hoisted(() => ({
  aiModels: vi.fn(),
  chooseModel: vi.fn(),
  testModel: vi.fn(),
  generate: vi.fn(),
  strategies: vi.fn(),
  aiConfig: vi.fn(),
  saveAiConfig: vi.fn(),
  aiProviderModels: vi.fn(),
  testAi: vi.fn(),
  aiUsage: vi.fn(),
}));

const period = (over = {}) => ({ calls: 0, ok: 0, failed: 0, fallbacks: 0, cost: 0, allPriced: true, providers: [], ...over });
const aiConfig = (over: Record<string, unknown> = {}) => ({
  provider: "ollama", textProvider: "ollama", visionProvider: "ollama", fallbackEnabled: false, fallbackProvider: null, taskProviders: {},
  providers: [
    { id: "ollama", label: "Ollama", local: true, keyConfigured: true, textModel: "gemma3:4b", visionModel: "gemma3:4b" },
    { id: "openai", label: "OpenAI", local: false, keyConfigured: true, textModel: "text-model-x", visionModel: "text-model-x" },
    { id: "gemini", label: "Gemini", local: false, keyConfigured: false, textModel: null, visionModel: null },
  ],
  dailyBudget: 0, monthlyBudget: 0, budgetOverride: false, currency: "INR",
  status: {
    text: { provider: "ollama", local: true, available: true, model: "gemma3:4b", detail: "ready" },
    vision: { provider: "ollama", local: true, available: true, model: "gemma3:4b", detail: "ready" },
  },
  budget: { exceeded: false, reason: null, dailySpent: null, monthlySpent: null },
  lastTest: null, mode: "local", vision: { maxFramesPerClip: 4, maxImageSize: 384, detail: "low" },
  ...over,
});

beforeEach(() => {
  api.aiConfig.mockResolvedValue(aiConfig());
  api.aiProviderModels.mockResolvedValue({ provider: "ollama", reachable: true, detail: null, models: [{ name: "gemma3:4b", vision: true }] });
  api.aiUsage.mockResolvedValue({ today: period(), week: period(), month: period(), currency: "INR",
                                  budget: { exceeded: false, reason: null, dailySpent: null, monthlySpent: null, daily: 0, monthly: 0, override: false } });
});
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));
vi.mock("@/hooks/useApi", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useApi")>()),
  useHealth: () => ({ data: { mongodb: true, ffmpeg: true, ai: { provider: "ollama", available: true, model: "gemma3:4b", detail: "ready" } }, isLoading: false, error: null }),
}));

import { AudioRangePicker, parseTime } from "@/components/AudioRangePicker";
import { ProjectTools } from "@/components/ProjectTools";
import { DurationSelector, formatLength } from "@/components/StyleSelector";
import SettingsPage from "@/app/settings/page";
import type { Project } from "@/types/api";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

/** A 200 s song whose second half is loud. */
function fakeAudio() {
  class FakeCtx {
    decodeAudioData() {
      const n = 200 * 100;
      const data = new Float32Array(n).map((_, i) => (i < n / 2 ? 0.1 : 0.9));
      return Promise.resolve({ duration: 200, getChannelData: () => data });
    }
    close() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("AudioContext", FakeCtx);
  Object.defineProperty(window, "AudioContext", { value: FakeCtx, configurable: true });
}
const song = () => Object.assign(new File(["x"], "song.mp3", { type: "audio/mpeg" }), { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });

beforeEach(() => {
  vi.clearAllMocks();
  fakeAudio();
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
  api.strategies.mockResolvedValue([]);
});

describe("DurationSelector: custom lengths", () => {
  function Host({ initial = 15 }: { initial?: number }) {
    const [v, setV] = useState(initial);
    return (
      <>
        <DurationSelector value={v} onChange={setV} />
        <output aria-label="seconds">{v}</output>
      </>
    );
  }

  it("formats lengths for people", () => {
    expect(formatLength(45)).toBe("45s");
    expect(formatLength(120)).toBe("2 min");
    expect(formatLength(305)).toBe("5 min 5s");
  });

  it("keeps the presets and adds a Custom option", async () => {
    render(<Host />);
    expect(screen.getByRole("radio", { name: "15s" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Custom" })).not.toBeChecked();
    expect(screen.queryByLabelText("Minutes")).not.toBeInTheDocument();
  });

  it("takes minutes and seconds, up to ten minutes", async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const min = screen.getByLabelText("Minutes");
    await userEvent.clear(min);
    await userEvent.type(min, "5");
    await userEvent.tab(); // commit: 5 min + the 15 s that were already there
    expect(screen.getByLabelText("seconds")).toHaveTextContent("315");
    const sec = screen.getByLabelText("Seconds");
    await userEvent.clear(sec);
    await userEvent.type(sec, "0");
    await userEvent.tab();
    expect(screen.getByLabelText("seconds")).toHaveTextContent("300");
    expect(screen.getByRole("radio", { name: "5 min" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "2 min" }));
    expect(screen.getByLabelText("seconds")).toHaveTextContent("120");
  });

  it("clamps to the limits instead of sending nonsense", async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const min = screen.getByLabelText("Minutes");
    await userEvent.clear(min);
    await userEvent.type(min, "45");
    await userEvent.tab();
    expect(screen.getByLabelText("seconds")).toHaveTextContent("600");
    const m2 = screen.getByLabelText("Minutes");
    await userEvent.clear(m2);
    await userEvent.type(m2, "0");
    await userEvent.tab(); // 0 min + 0 s is below the minimum
    expect(screen.getByLabelText("seconds")).toHaveTextContent("5");
  });

  it("shows an existing custom length as selected", () => {
    render(<Host initial={150} />);
    expect(screen.getByRole("radio", { name: "2 min 30s" })).toBeChecked();
    expect(screen.getByLabelText("Minutes")).toHaveValue(2);
    expect(screen.getByLabelText("Seconds")).toHaveValue(30);
  });

  it("choosing a preset closes the custom panel", async () => {
    render(<Host initial={150} />);
    await userEvent.click(screen.getByRole("radio", { name: "30s" }));
    expect(screen.queryByLabelText("Minutes")).not.toBeInTheDocument();
    expect(screen.getByLabelText("seconds")).toHaveTextContent("30");
  });
});

describe("AudioRangePicker: choose the part of the song", () => {
  it("parses typed times", () => {
    expect(parseTime("1:30")).toBe(90);
    expect(parseTime("0:05.5")).toBe(5.5);
    expect(parseTime("75")).toBe(75);
    expect(parseTime("abc")).toBeNull();
    expect(parseTime("")).toBeNull();
  });

  function Host({ duration = 60, initial = null as number | null }) {
    const [s, setS] = useState<number | null>(initial);
    const [file] = useState(song); // one File for the life of the page, like the real form
    return (
      <>
        <AudioRangePicker source={file} duration={duration} start={s} onChange={setS} />
        <output aria-label="start">{s === null ? "auto" : s}</output>
      </>
    );
  }

  it("starts automatic, reads the song and says how long it is", async () => {
    render(<Host />);
    expect(await screen.findByText(/Song 3:20/)).toBeInTheDocument();
    expect(screen.getByLabelText("start")).toHaveTextContent("auto");
    expect(screen.getByRole("checkbox", { name: /Let the app choose/ })).toBeChecked();
    expect(screen.getByLabelText("Start of the part of the song")).toBeDisabled();
  });

  it("lets the user pick a part with the slider, limited so the whole Reel fits", async () => {
    render(<Host />);
    await screen.findByText(/Song 3:20/);
    await userEvent.click(screen.getByRole("checkbox", { name: /Let the app choose/ }));
    const slider = screen.getByLabelText("Start of the part of the song");
    expect(slider).toBeEnabled();
    expect(slider).toHaveAttribute("max", "140"); // 200 s song - 60 s Reel
    fireEvent.change(slider, { target: { value: "95" } });
    expect(screen.getByLabelText("start")).toHaveTextContent("95");
    expect(await screen.findByText("Using 1:35 – 2:35 of a 3:20 song")).toBeInTheDocument();
    expect(screen.getByTestId("range-window").style.width).toBe("30%"); // 60 / 200
    expect(screen.getByTestId("range-window").style.left).toBe("47.5%");
  });

  it("accepts a typed start time and keeps it inside the song", async () => {
    render(<Host initial={0} />);
    await screen.findByText(/Using 0:00/);
    const box = screen.getByLabelText("Start time");
    await userEvent.clear(box);
    await userEvent.type(box, "1:30");
    await userEvent.tab();
    expect(screen.getByLabelText("start")).toHaveTextContent("90");
    await userEvent.clear(box);
    await userEvent.type(box, "9:00"); // past the end
    await userEvent.tab();
    expect(screen.getByLabelText("start")).toHaveTextContent("140");
  });

  it("finds the loudest part", async () => {
    render(<Host initial={0} duration={60} />);
    await screen.findByText(/Using 0:00/);
    await userEvent.click(screen.getByRole("button", { name: "Pick the loudest part" }));
    // the second half (100 s onward) is loud, so the best 60 s window starts at 100 s or later, at most 140 s
    const v = Number(screen.getByLabelText("start").textContent);
    expect(v).toBeGreaterThanOrEqual(100);
    expect(v).toBeLessThanOrEqual(140);
  });

  it("warns when the song is not longer than the Reel and disables choosing", async () => {
    render(<Host duration={300} initial={10} />);
    expect(await screen.findByText(/all of it is used and the Reel is shortened/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Start of the part of the song")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▶ Play the song" })).toBeEnabled(); // never a dead button
  });

  it("still lets the user type a start when the preview cannot decode the song", async () => {
    Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
    vi.stubGlobal("AudioContext", undefined);
    render(<Host initial={20} />);
    expect(await screen.findByText(/Preview not available/)).toBeInTheDocument();
    expect(screen.getByLabelText("Start time")).toHaveValue("0:20");
  });
});

/** A stand-in for the browser's Audio element that records what the picker does with it. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  static rejectWith: Error | null = null;
  static ready = 1; // HTMLMediaElement.readyState: 0 = the file's length is not known yet
  src: string;
  currentTime = 0;
  readyState = FakeAudio.ready;
  paused = true;
  ontimeupdate: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, () => void> = {};
  playCalls = 0;
  loadCalls = 0;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; }
  load() { this.loadCalls++; }
  play() {
    this.playCalls++;
    if (FakeAudio.rejectWith) return Promise.reject(FakeAudio.rejectWith);
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; }
}

describe("AudioRangePicker: the play button", () => {
  function Host({ duration = 60, initial = null as number | null }) {
    const [s, setS] = useState<number | null>(initial);
    const [file] = useState(song);
    return <AudioRangePicker source={file} duration={duration} start={s} onChange={setS} />;
  }
  beforeEach(() => {
    FakeAudio.instances = [];
    FakeAudio.rejectWith = null;
    FakeAudio.ready = 1;
    vi.stubGlobal("Audio", FakeAudio);
  });

  it("plays the chosen part, even in React's development double-mount (which used to revoke the song's link first)", async () => {
    render(
      <StrictMode>
        <Host initial={95} />
      </StrictMode>,
    );
    await screen.findByText(/Using 1:35/);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // nothing may release the link before it is used
    await userEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
    const a = FakeAudio.instances[0];
    expect(a.src).toBe("blob:mock");
    expect(a.currentTime).toBe(95);
    expect(a.playCalls).toBe(1);
    expect(await screen.findByRole("button", { name: "■ Stop" })).toBeInTheDocument();
  });

  it("stops by itself at the end of the chosen part, and the Stop button works", async () => {
    render(<Host initial={95} />);
    await screen.findByText(/Using 1:35/);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
    const a = FakeAudio.instances[0];
    a.currentTime = 120;
    act(() => a.ontimeupdate?.());
    expect(screen.getByRole("button", { name: "■ Stop" })).toBeInTheDocument(); // still inside the part
    a.currentTime = 155.1; // 95 + 60
    act(() => a.ontimeupdate?.());
    expect(await screen.findByRole("button", { name: "▶ Play this part" })).toBeInTheDocument();
    expect(a.paused).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
    await userEvent.click(await screen.findByRole("button", { name: "■ Stop" }));
    expect(a.paused).toBe(true);
    expect(a.currentTime).toBe(95); // pressing play again starts from the start of the part
  });

  it("is usable in automatic mode too: it plays the song from the start so the user can decide", async () => {
    render(<Host />);
    await screen.findByText(/Song 3:20/);
    const btn = screen.getByRole("button", { name: "▶ Play the song" });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(FakeAudio.instances[0].currentTime).toBe(0);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
  });

  it("waits until the file's length is known before jumping to the part", async () => {
    FakeAudio.ready = 0;
    render(<Host initial={95} />);
    await screen.findByText(/Using 1:35/);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
    const a = FakeAudio.instances[0];
    expect(a.playCalls).toBe(0); // seeking now would be ignored by the browser
    expect(a.loadCalls).toBe(1);
    act(() => a.listeners.loadedmetadata?.());
    expect(a.currentTime).toBe(95);
    expect(a.playCalls).toBe(1);
  });

  it("shows that the song is loading (never a button that seems to do nothing) and starts as soon as it is ready", async () => {
    FakeAudio.ready = 0;
    render(<Host initial={95} />);
    await screen.findByText(/Using 1:35/);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Loading the song");
    const a = FakeAudio.instances[0];
    act(() => a.listeners.loadedmetadata?.());
    expect(await screen.findByRole("button", { name: "■ Stop" })).toBeInTheDocument();
    expect(a.currentTime).toBe(95);
    expect(screen.queryByText(/Loading the song/)).not.toBeInTheDocument();
  });

  it("says so when the song is still not ready after a while, and playing again is possible", async () => {
    FakeAudio.ready = 0;
    render(<Host initial={95} />);
    await screen.findByText(/Using 1:35/);
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
      expect(screen.getByRole("button", { name: "Loading…" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(8100));
      expect(screen.getByRole("alert")).toHaveTextContent("taking too long to load");
      expect(screen.getByRole("button", { name: "▶ Play this part" })).toBeInTheDocument();
      const a = FakeAudio.instances[0];
      act(() => a.listeners.loadedmetadata?.()); // a late arrival must not start music the user has given up on
      expect(a.playCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pressing the button while loading cancels the request", async () => {
    FakeAudio.ready = 0;
    render(<Host initial={95} />);
    await screen.findByText(/Using 1:35/);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
    await userEvent.click(screen.getByRole("button", { name: "Loading…" }));
    expect(screen.getByRole("button", { name: "▶ Play this part" })).toBeInTheDocument();
    act(() => FakeAudio.instances[0].listeners.loadedmetadata?.());
    expect(FakeAudio.instances[0].playCalls).toBe(0);
  });

  it("says why when the browser refuses to play, instead of doing nothing", async () => {
    FakeAudio.rejectWith = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
    render(<Host initial={95} />);
    await screen.findByText(/Using 1:35/);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The browser blocked playback");
    expect(screen.getByRole("button", { name: "▶ Play this part" })).toBeInTheDocument();
  });

  /** Give the waveform a size (jsdom has no layout): 800 px wide, starting at x = 0. */
  function sizeTheWaveform() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 64, right: 800, bottom: 64, x: 0, y: 0, toJSON() {} } as DOMRect);
  }

  it("starts playing by itself when the user clicks or drags the waveform: no need to press play", async () => {
    sizeTheWaveform();
    render(<Host />); // automatic mode to begin with
    await screen.findByText(/Song 3:20/);
    const wave = document.querySelector("[role=presentation]") as HTMLElement;
    fireEvent.pointerDown(wave, { clientX: 400, pointerId: 1, buttons: 1 }); // the middle of a 200 s song, window centred on it
    const a = FakeAudio.instances[0];
    expect(a.currentTime).toBe(70); // 100 s - half of the 60 s window
    expect(a.playCalls).toBe(1);
    expect(await screen.findByRole("button", { name: "■ Stop" })).toBeInTheDocument();
    expect(screen.getByLabelText("Start time")).toHaveValue("1:10");
  });

  it("dragging while it plays just moves the sound: it is never stopped and restarted", async () => {
    sizeTheWaveform();
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (t += 500)); // every move is far enough apart to be followed
    render(<Host />);
    await screen.findByText(/Song 3:20/);
    const wave = document.querySelector("[role=presentation]") as HTMLElement;
    fireEvent.pointerDown(wave, { clientX: 200, pointerId: 1, buttons: 1 });
    const a = FakeAudio.instances[0];
    expect(a.currentTime).toBe(20); // x=200 of 800 -> 50 s, minus 30
    fireEvent.pointerMove(wave, { clientX: 400, buttons: 1 });
    expect(a.currentTime).toBe(70);
    fireEvent.pointerMove(wave, { clientX: 600, buttons: 1 });
    expect(a.currentTime).toBe(120);
    expect(a.playCalls).toBe(1); // play() was called once: the later moves only seek
    expect(a.paused).toBe(false);
    expect(FakeAudio.instances).toHaveLength(1); // and it is the same audio element throughout
  });

  it("when the drag ends the sound is exactly where the window is, even if the last moves were skipped for speed", async () => {
    sizeTheWaveform();
    vi.spyOn(performance, "now").mockReturnValue(1000); // moves come faster than the follow rate, so they are skipped
    render(<Host />);
    await screen.findByText(/Song 3:20/);
    const wave = document.querySelector("[role=presentation]") as HTMLElement;
    fireEvent.pointerDown(wave, { clientX: 200, pointerId: 1, buttons: 1 });
    const a = FakeAudio.instances[0];
    fireEvent.pointerMove(wave, { clientX: 600, buttons: 1 });
    expect(a.currentTime).toBe(20); // skipped while dragging fast
    fireEvent.pointerUp(wave);
    expect(a.currentTime).toBe(120); // settled on the final position
    expect(a.playCalls).toBe(1);
  });

  it("moving the slider, typing a start, or picking the loudest part also plays from there", async () => {
    render(<Host initial={0} />);
    await screen.findByText(/Using 0:00/);
    fireEvent.change(screen.getByLabelText("Start of the part of the song"), { target: { value: "95" } });
    const a = FakeAudio.instances[0];
    expect(a.currentTime).toBe(95);
    expect(a.playCalls).toBe(1);

    const box = screen.getByLabelText("Start time");
    await userEvent.clear(box);
    await userEvent.type(box, "2:00");
    await userEvent.tab();
    expect(a.currentTime).toBe(120);
    expect(a.playCalls).toBe(1); // still the same playing sound, moved

    await userEvent.click(screen.getByRole("button", { name: "Pick the loudest part" }));
    expect(a.currentTime).toBeGreaterThanOrEqual(100); // the loud half of the fake song
    expect(a.playCalls).toBe(1);
  });

  it("shows where the sound is with a moving line, and it stops at the end of the chosen part", async () => {
    sizeTheWaveform();
    render(<Host />);
    await screen.findByText(/Song 3:20/);
    fireEvent.pointerDown(document.querySelector("[role=presentation]") as HTMLElement, { clientX: 400, pointerId: 1, buttons: 1 });
    const a = FakeAudio.instances[0];
    await screen.findByRole("button", { name: "■ Stop" }); // playing
    a.currentTime = 100;
    act(() => a.ontimeupdate?.());
    expect(screen.getByTestId("playhead").style.left).toBe("50%");
    a.currentTime = 130.1; // 70 + 60
    act(() => a.ontimeupdate?.());
    expect(await screen.findByRole("button", { name: "▶ Play this part" })).toBeInTheDocument();
    expect(screen.queryByTestId("playhead")).not.toBeInTheDocument();
  });

  it("handing the choice back to the app stops the preview and does not start one", async () => {
    render(<Host initial={0} />);
    await screen.findByText(/Using 0:00/);
    expect(FakeAudio.instances).toHaveLength(0); // opening the picker never plays anything
    fireEvent.change(screen.getByLabelText("Start of the part of the song"), { target: { value: "50" } });
    const a = FakeAudio.instances[0];
    await userEvent.click(screen.getByRole("checkbox", { name: /Let the app choose/ }));
    expect(a.paused).toBe(true);
  });

  it("releases the song's link and stops the sound when the picker goes away", async () => {
    const { unmount } = render(<Host initial={95} />);
    await screen.findByText(/Using 1:35/);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play this part" }));
    const a = FakeAudio.instances[0];
    unmount();
    expect(a.paused).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});

describe("Regenerate with a different part of the song", () => {
  const project = (over = {}) =>
    ({ id: "p1", name: "P", status: "completed", settings: { language: "en", audioMode: "music", duration: 60, audioStart: null }, videos: [{ id: "v" }],
       audio: { id: "a", url: "/api/x/audio", duration: 200 }, ...over }) as unknown as Project;

  it("sends the chosen start", async () => {
    api.generate.mockResolvedValue({ id: "j" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    wrap(<ProjectTools project={project({ settings: { language: "en", audioMode: "music", duration: 60, audioStart: 30 } })} busy={false} />);
    await screen.findByText(/Song 3:20|Using 0:30/);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate with this part" }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledWith("p1", { audioStart: 30, label: "Song part from 0:30" }));
  });

  it("can hand the choice back to the app", async () => {
    api.generate.mockResolvedValue({ id: "j" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    wrap(<ProjectTools project={project()} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate with this part" }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledWith("p1", { audioAuto: true, label: "Song part: automatic" }));
  });

  it("is not offered without music, and is locked while a render runs", () => {
    wrap(<ProjectTools project={project({ audio: null })} busy={false} />);
    expect(screen.queryByText("Part of the song")).not.toBeInTheDocument();
  });
});

describe("Change the song", () => {
  const project = (over = {}) =>
    ({ id: "p1", name: "P", status: "completed", settings: { language: "en", audioMode: "music", duration: 60, audioStart: null }, videos: [{ id: "v" }],
       audio: { id: "a", url: "/api/x/audio", name: "old.mp3", duration: 200, size: 4_000_000 }, ...over }) as unknown as Project;

  it("shows the current song and replaces it with a dropped file, then regenerates with the best part", async () => {
    (api as unknown as { uploadAudio: ReturnType<typeof vi.fn> }).uploadAudio = vi.fn().mockResolvedValue({ id: "a2" });
    api.generate.mockResolvedValue({ id: "j" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    wrap(<ProjectTools project={project()} busy={false} />);
    expect(screen.getByText(/old\.mp3/)).toBeInTheDocument();
    const input = screen.getByLabelText(/Drop a different song here to replace it/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [song()] } });
    await waitFor(() => expect((api as unknown as { uploadAudio: ReturnType<typeof vi.fn> }).uploadAudio).toHaveBeenCalledWith("p1", expect.any(File)));
    await waitFor(() => expect(api.generate).toHaveBeenCalledWith("p1", { audioAuto: true, label: "Song changed: song.mp3" }));
  });

  it("offers to add a song when there is none yet", () => {
    wrap(<ProjectTools project={project({ audio: null })} busy={false} />);
    expect(screen.getByText("No song yet.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Drop a song here/i)).toBeInTheDocument();
  });
});

describe("Settings: choose the AI model", () => {
  const models = (over = {}) => ({
    provider: "ollama", reachable: true, detail: null, current: "gemma3:4b", source: "env", envModel: "gemma3:4b",
    needsVision: "Content analysis needs a model with vision.",
    models: [
      { name: "gemma3:4b", sizeGb: 3.3, capabilities: ["vision"], vision: true, thinking: false, embeddingOnly: false, current: true },
      { name: "qwen3.5:4b", sizeGb: 3.4, capabilities: ["vision", "thinking"], vision: true, thinking: true, embeddingOnly: false, current: false },
      { name: "nomic-embed", sizeGb: 0.3, capabilities: ["embedding"], vision: false, thinking: false, embeddingOnly: true, current: false },
    ],
    ...over,
  });

  it("lists installed models with what they can do and hides embedding-only ones", async () => {
    api.aiModels.mockResolvedValue(models());
    wrap(<SettingsPage />);
    const select = await screen.findByLabelText("AI model");
    const opts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(opts).toEqual(["gemma3:4b · 3.3 GB · vision (in use)", "qwen3.5:4b · 3.4 GB · vision · reasoning"]);
    expect(screen.getByText(/from OLLAMA_MODEL in .env/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this model" })).toBeDisabled(); // nothing to change yet
  });

  it("saves the chosen model and shows it as in use", async () => {
    api.aiModels.mockResolvedValue(models());
    api.chooseModel.mockResolvedValue(models({ current: "qwen3.5:4b", source: "settings" }));
    wrap(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("AI model"), "qwen3.5:4b");
    expect(screen.getByText(/turns that off for structured answers/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use this model" }));
    await waitFor(() => expect(api.chooseModel).toHaveBeenCalledWith("qwen3.5:4b"));
    expect(await screen.findByText(/\(chosen here\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go back to the .env model \(gemma3:4b\)/ })).toBeInTheDocument();
  });

  it("tests a model without switching to it and reports the verdict honestly", async () => {
    api.aiModels.mockResolvedValue(models());
    api.testModel.mockResolvedValue({ model: "qwen3.5:4b", ok: false, seconds: 109.2, verdict: "over-eager", detail: "Understood it but also added actions you did not ask for: style." });
    wrap(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("AI model"), "qwen3.5:4b");
    await userEvent.click(screen.getByRole("button", { name: "Test it" }));
    const box = await screen.findByRole("status", { name: "Model test result" });
    expect(box).toHaveTextContent("qwen3.5:4b: Added actions nobody asked for · 109.2s");
    expect(box).toHaveTextContent("also added actions you did not ask for: style");
    expect(api.chooseModel).not.toHaveBeenCalled();
  });

  it("explains when Ollama is not running", async () => {
    api.aiModels.mockResolvedValue(models({ reachable: false, detail: "Cannot reach Ollama at http://localhost:11434.", models: [] }));
    wrap(<SettingsPage />);
    expect(await screen.findByText("Ollama is not reachable")).toBeInTheDocument();
    expect(screen.getByText(/Cannot reach Ollama/)).toBeInTheDocument();
  });

  it("warns when the chosen model has no vision", async () => {
    api.aiModels.mockResolvedValue(models({ models: [
      { name: "gemma3:4b", sizeGb: 3.3, capabilities: ["vision"], vision: true, thinking: false, embeddingOnly: false, current: true },
      { name: "phi:2b", sizeGb: 1.6, capabilities: ["completion"], vision: false, thinking: false, embeddingOnly: false, current: false },
    ] }));
    wrap(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("AI model"), "phi:2b");
    expect(screen.getByText(/does not report vision/)).toBeInTheDocument();
  });
});

describe("Settings: AI provider, fallback, test, usage", () => {
  it("shows the provider choice, LOCAL AI badge and never asks for an API key in the browser", async () => {
    api.aiModels.mockResolvedValue({ provider: "ollama", reachable: true, detail: null, current: "gemma3:4b", source: "env", envModel: "gemma3:4b", needsVision: "", models: [] });
    wrap(<SettingsPage />);
    const select = await screen.findByLabelText("AI Provider");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Ollama (local)", "OpenAI (cloud)", "Gemini (no API key)"]);
    expect(screen.getAllByText("LOCAL AI").length).toBeGreaterThan(0);
    await userEvent.selectOptions(select, "gemini");
    expect(screen.getByText(/GEMINI_API_KEY to the backend/)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("does not show the Ollama picker when Ollama is not in use", async () => {
    api.aiConfig.mockResolvedValue(aiConfig({ provider: "openai", textProvider: "openai", visionProvider: "openai", mode: "cloud",
      status: { text: { provider: "openai", local: false, available: true, model: "text-model-x", detail: "ready" },
                vision: { provider: "openai", local: false, available: true, model: "text-model-x", detail: "ready" } } }));
    wrap(<SettingsPage />);
    expect((await screen.findAllByText("CLOUD AI")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Ollama model (on this computer)")).toBeNull();
    expect(api.aiModels).not.toHaveBeenCalled();
  });

  it("saves provider, models and fallback, then tests the connection", async () => {
    api.aiModels.mockResolvedValue({ provider: "ollama", reachable: true, detail: null, current: "gemma3:4b", source: "env", envModel: "gemma3:4b", needsVision: "", models: [] });
    api.aiProviderModels.mockImplementation((p: string) => Promise.resolve({ provider: p, reachable: true, detail: null,
      models: p === "openai" ? [{ name: "text-model-x", vision: null }, { name: "text-model-y", vision: null }] : [{ name: "gemma3:4b", vision: true }] }));
    api.saveAiConfig.mockResolvedValue(aiConfig());
    api.testAi.mockResolvedValue({ provider: "openai", model: "text-model-y", ok: true, correct: true, detail: "Connected; the answer was correct.", latencyMs: 820 });
    wrap(<SettingsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("AI Provider"), "openai");
    await userEvent.selectOptions(await screen.findByLabelText("Text Model"), "text-model-y");
    await userEvent.click(screen.getByLabelText("Enable fallback"));
    await userEvent.selectOptions(screen.getByLabelText("Fallback Provider"), "gemini");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveAiConfig).toHaveBeenCalled());
    const body = api.saveAiConfig.mock.calls[0][0];
    expect(body).toMatchObject({ provider: "openai", fallbackEnabled: true, fallbackProvider: "gemini", models: { openai: { text: "text-model-y" } } });
    await userEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    const box = await screen.findByRole("status", { name: "AI test result" });
    expect(box).toHaveTextContent("openai · text-model-y: connected · 0.8s");
  });

  it("shows usage per period with cost and provider breakdown", async () => {
    api.aiModels.mockResolvedValue({ provider: "ollama", reachable: true, detail: null, current: "gemma3:4b", source: "env", envModel: "gemma3:4b", needsVision: "", models: [] });
    api.aiUsage.mockResolvedValue({
      today: period({ calls: 12, ok: 11, failed: 1, cost: 3.5, providers: [{ provider: "openai", calls: 12, ok: 11, failed: 1, cost: 3.5 }] }),
      week: period({ calls: 30, ok: 30, cost: 9 }), month: period({ calls: 80, ok: 78, failed: 2, cost: 20, allPriced: false }), currency: "INR",
      budget: { exceeded: true, reason: "today's AI budget is used up", dailySpent: 3.5, monthlySpent: 20, daily: 3, monthly: 0, override: false },
    });
    wrap(<SettingsPage />);
    expect(await screen.findByText("12 calls")).toBeInTheDocument();
    expect(screen.getByText(/Estimated cost: ₹3.50/)).toBeInTheDocument();
    expect(screen.getByText(/some models not priced/)).toBeInTheDocument();
    expect(screen.getByText(/today's AI budget is used up/)).toBeInTheDocument();
  });
});
