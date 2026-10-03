import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InstagramReport } from "@/components/InstagramReport";
import { PostCopy } from "@/components/PostCopy";
import type { InstagramReport as Report } from "@/types/api";

const report: Report = {
  platform: "instagram",
  score: 40,
  verdict: "Not recommended to new viewers until fixed: no logo or watermark over the video",
  blocked: ["No logo or watermark over the video"],
  signals: [
    { id: "hook", label: "Hold the first 3 seconds (skip rate)", score: 100 },
    { id: "eligibility", label: "Can be recommended", score: 50 },
  ],
  checks: [
    { id: "first_cut", signal: "hook", name: "The picture changes within 2 seconds", status: "pass", detail: "the opening shot lasts 1.5s", tip: "" },
    { id: "watermark", signal: "eligibility", name: "No logo or watermark over the video", status: "fail", detail: "on every frame",
      tip: "Reels with logos or watermarks are recommended less: show the brand only at the end." },
    { id: "original", signal: "eligibility", name: "Your own, original footage", status: "info", detail: "", tip: "Use footage you filmed." },
  ],
  postingTips: ["Reply to comments in the first hour."],
  note: "This score checks what can be measured before posting.",
};

describe("InstagramReport", () => {
  it("shows the score, what blocks recommendations, each signal and the posting tips", () => {
    render(<InstagramReport report={report} />);
    expect(screen.getByLabelText("Score 40 out of 100")).toBeInTheDocument();
    expect(screen.getByText(/Not recommended to new viewers/)).toBeInTheDocument();
    expect(screen.getByText("Fix before posting")).toBeInTheDocument();
    expect(screen.getByText(/show the brand only at the end/)).toBeInTheDocument();
    expect(screen.getByLabelText("The picture changes within 2 seconds: passes")).toBeInTheDocument();
    expect(screen.getByLabelText("No logo or watermark over the video: fails")).toBeInTheDocument();
    expect(screen.getByText("Reply to comments in the first hour.")).toBeInTheDocument();
  });
});

describe("PostCopy for Instagram", () => {
  it("shows the send line, hashtags and alt text, and labels a template", () => {
    render(
      <PostCopy
        copy={{ title: "Vada pav", description: "Best vada pav in Pune.", hashtags: ["vada", "pune"], sendPrompt: "Send this to someone who needs to see it.",
          altText: "Vertical video: Best vada pav in Pune.", platform: "instagram", source: "template" }}
      />,
    );
    expect(screen.getByText("Instagram caption")).toBeInTheDocument();
    expect(screen.getByText("Send this to someone who needs to see it.")).toBeInTheDocument();
    expect(screen.getByText("#vada #pune")).toBeInTheDocument();
    expect(screen.getByText("Vertical video: Best vada pav in Pune.")).toBeInTheDocument();
    expect(screen.getByText(/A plain template/)).toBeInTheDocument();
  });
});
