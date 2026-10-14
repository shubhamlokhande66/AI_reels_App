import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const api = vi.hoisted(() => ({ chat: vi.fn(), uploadChatFile: vi.fn(), generateTemplateFromChat: vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import ChatPage from "@/app/chat/page";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChatPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("Chat (free-form conversation with the AI, separate from any project)", () => {
  it("shows idea chips and no messages before anything is sent", () => {
    renderPage();
    expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pace works best/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("clicking an idea chip fills the message box", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /How long should a Reel be/ }));
    expect(screen.getByLabelText("Message")).toHaveValue("How long should a Reel be for Instagram?");
  });

  it("sends a message and shows the reply", async () => {
    api.chat.mockResolvedValue({ reply: "Aim for 15-30 seconds for most feeds." });
    renderPage();
    await userEvent.type(screen.getByLabelText("Message"), "How long should a Reel be?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Aim for 15-30 seconds for most feeds.")).toBeInTheDocument());
    expect(screen.getByText("How long should a Reel be?")).toBeInTheDocument();
    expect(api.chat).toHaveBeenCalledWith([{ role: "user", content: "How long should a Reel be?", images: [] }]);
    expect(screen.getByLabelText("Message")).toHaveValue(""); // cleared after sending
  });

  it("sends the whole conversation so far, not just the latest message", async () => {
    api.chat.mockResolvedValueOnce({ reply: "Upbeat or relaxed?" }).mockResolvedValueOnce({ reply: "Try something acoustic and warm." });
    renderPage();
    await userEvent.type(screen.getByLabelText("Message"), "I want a beach vibe{Enter}");
    await waitFor(() => expect(screen.getByText("Upbeat or relaxed?")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Message"), "Relaxed{Enter}");
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(2));
    expect(api.chat.mock.calls[1][0]).toEqual([
      { role: "user", content: "I want a beach vibe", images: [] },
      { role: "assistant", content: "Upbeat or relaxed?" },
      { role: "user", content: "Relaxed", images: [] },
    ]);
  });

  it("Enter sends, Shift+Enter adds a newline instead", async () => {
    api.chat.mockResolvedValue({ reply: "ok" });
    renderPage();
    const box = screen.getByLabelText("Message");
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("line one\nline two");
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("cannot send an empty or whitespace-only message", async () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Message"), "   ");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("shows a friendly error and keeps the message on failure, with a retry", async () => {
    api.chat.mockRejectedValueOnce(new Error("The local AI model is not reachable.")).mockResolvedValueOnce({ reply: "Now it works." });
    renderPage();
    await userEvent.type(screen.getByLabelText("Message"), "hello{Enter}");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("The local AI model is not reachable.")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument(); // the user's message is not lost

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Now it works.")).toBeInTheDocument());
    expect(api.chat).toHaveBeenCalledTimes(2);
    expect(api.chat.mock.calls[1][0]).toEqual([{ role: "user", content: "hello", images: [] }]);
  });

  it("Clear resets the conversation", async () => {
    api.chat.mockResolvedValue({ reply: "hi there" });
    renderPage();
    await userEvent.type(screen.getByLabelText("Message"), "hello{Enter}");
    await waitFor(() => expect(screen.getByText("hi there")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("hi there")).not.toBeInTheDocument();
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pace works best/ })).toBeInTheDocument();
  });
});

const attach = () => screen.getByLabelText("Attach files") as HTMLInputElement;
const textFile = (name: string) => new File(["remember: louder music"], name, { type: "text/plain" });
const image = (name = "photo.jpg") => new File(["fake-jpeg-bytes"], name, { type: "image/jpeg" });

describe("Chat attachments (images, video, audio, PDF, text/code)", () => {
  it("uploads a file on attach and shows it as a chip", async () => {
    api.uploadChatFile.mockResolvedValue({ name: "notes.txt", kind: "text", mime: "text/plain", sizeBytes: 20, text: "remember: louder music", images: [], truncated: false });
    renderPage();
    const input = attach();
    await userEvent.upload(input, textFile("notes.txt"));

    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());
    expect(api.uploadChatFile).toHaveBeenCalledWith(expect.objectContaining({ name: "notes.txt" }));
  });

  it("a failed upload shows an inline error and does not attach", async () => {
    const err = new Error("'archive.zip' files aren't supported yet.");
    api.uploadChatFile.mockRejectedValue(err);
    renderPage();
    await userEvent.upload(attach(), new File(["x"], "archive.zip", { type: "application/zip" }));

    await waitFor(() => expect(screen.getByText(/archive.zip: .*aren't supported yet/)).toBeInTheDocument());
    expect(screen.queryByText("archive.zip")).not.toBeInTheDocument();
  });

  it("removing an attachment before sending drops it", async () => {
    api.uploadChatFile.mockResolvedValue({ name: "notes.txt", kind: "text", mime: "text/plain", sizeBytes: 20, text: "hi", images: [], truncated: false });
    renderPage();
    await userEvent.upload(attach(), textFile("notes.txt"));
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("sending a text/PDF attachment folds its content into the message and sends no images", async () => {
    api.uploadChatFile.mockResolvedValue({ name: "notes.txt", kind: "text", mime: "text/plain", sizeBytes: 20, text: "remember: louder music", images: [], truncated: false });
    api.chat.mockResolvedValue({ reply: "Got it." });
    renderPage();
    await userEvent.upload(attach(), textFile("notes.txt"));
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("Message"), "use this");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Got it.")).toBeInTheDocument());
    expect(api.chat).toHaveBeenCalledWith([
      { role: "user", content: "[Attached file: notes.txt]\nremember: louder music\n[End of notes.txt]\n\nuse this", images: [] },
    ]);
    expect(screen.getByText("use this")).toBeInTheDocument(); // shown in the bubble without the raw file dump
    expect(screen.getByText("notes.txt")).toBeInTheDocument(); // still shown as a chip on the sent message
  });

  it("sending an image attachment (no typed text) sends its base64 in images", async () => {
    api.uploadChatFile.mockResolvedValue({ name: "photo.jpg", kind: "image", mime: "image/jpeg", sizeBytes: 500, images: ["ZmFrZQ=="], truncated: false });
    api.chat.mockResolvedValue({ reply: "That looks like a product shot." });
    renderPage();
    await userEvent.upload(attach(), image());
    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("That looks like a product shot.")).toBeInTheDocument());
    expect(api.chat).toHaveBeenCalledWith([{ role: "user", content: "Please look at what I attached.", images: ["ZmFrZQ=="] }]);
  });

  it("blocks sending when more than 4 images would be attached", async () => {
    api.uploadChatFile
      .mockResolvedValueOnce({ name: "a.jpg", kind: "image", mime: "image/jpeg", sizeBytes: 1, images: ["a"], truncated: false })
      .mockResolvedValueOnce({ name: "b.mp4", kind: "video", mime: "video/mp4", sizeBytes: 1, text: "a video", images: ["b1", "b2", "b3", "b4"], truncated: false });
    renderPage();
    await userEvent.upload(attach(), image("a.jpg"));
    await waitFor(() => expect(screen.getByText("a.jpg")).toBeInTheDocument());
    await userEvent.upload(attach(), new File(["v"], "b.mp4", { type: "video/mp4" }));
    await waitFor(() => expect(screen.getByText("b.mp4")).toBeInTheDocument());

    expect(screen.getByText(/At most 4 images/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

describe("Save as Reel template (Chat -> Templates hand-off)", () => {
  it("is hidden until the AI has actually replied", async () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /Save as Reel template/ })).not.toBeInTheDocument();

    api.chat.mockResolvedValue({ reply: "Sure." });
    await userEvent.type(screen.getByLabelText("Message"), "make it calmer{Enter}");
    await waitFor(() => expect(screen.getByText("Sure.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Save as Reel template/ })).toBeInTheDocument();
  });

  it("drafts a template from the conversation and hands it to the Templates page", async () => {
    api.chat.mockResolvedValueOnce({ reply: "Got it — calm pace, no captions." });
    api.generateTemplateFromChat.mockResolvedValue({
      draft: true,
      template: { name: "Calm Reels", description: "", duration: 20, style: "luxury", pace: "calm", hook: true, captions: false,
        captionStyle: "minimal", audioMode: "music", musicSync: true, ai: false, language: "en", exportPreset: "instagram_reel" },
    });
    renderPage();
    await userEvent.type(screen.getByLabelText("Message"), "I want my Reels calmer, no captions{Enter}");
    await waitFor(() => expect(screen.getByText("Got it — calm pace, no captions.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Save as Reel template/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/templates"));
    expect(api.generateTemplateFromChat).toHaveBeenCalledTimes(1);
    const sent = api.generateTemplateFromChat.mock.calls[0][0] as string;
    expect(sent).toContain("user: I want my Reels calmer, no captions");
    expect(sent).toContain("assistant: Got it — calm pace, no captions.");
    expect(JSON.parse(sessionStorage.getItem("chat-template-draft") ?? "null")).toMatchObject({ name: "Calm Reels", pace: "calm" });
  });

  it("shows an error and does not navigate if drafting fails", async () => {
    api.chat.mockResolvedValueOnce({ reply: "ok" });
    api.generateTemplateFromChat.mockRejectedValue(new Error("The local AI model is not reachable."));
    renderPage();
    await userEvent.type(screen.getByLabelText("Message"), "hi{Enter}");
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Save as Reel template/ }));
    await waitFor(() => expect(screen.getByText("The local AI model is not reachable.")).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });
});
