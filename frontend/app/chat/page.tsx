"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { stashTemplateDraft } from "@/lib/templateDraftHandoff";
import type { ChatFile, ChatFileKind, ChatMessage } from "@/types/api";

const IDEAS = [
  "What pace works best for a product Reel?",
  "How long should a Reel be for Instagram?",
  "What's the difference between a wipe and a dissolve?",
  "Give me 3 caption style ideas for a fitness Reel",
];

// Kept in step with the backend (app/api/chat.py) so a bad attempt is caught here instead of round-tripping.
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_MESSAGE_LEN = 20_000;
const MAX_TRANSCRIPT_CHARS = 8_000; // matches app/api/templates.py's GenerateTemplateFromChat

const KIND_ICON: Record<ChatFileKind, string> = { image: "🖼", video: "🎬", audio: "♪", text: "▤" };

interface Attachment extends ChatFile {
  id: string;
}

interface DisplayMessage extends ChatMessage {
  attachments?: Attachment[]; // for rendering chips only — content/images already carry everything sent to the API
  displayText?: string; // what the person actually typed; shown instead of the raw content (which also has file text folded in)
}

/**
 * A free-form chat with the AI: brainstorm a direction or ask questions and get plain-text answers back — separate
 * from "Change this Reel", which turns an instruction into a real edit on a specific project. Nothing here touches
 * any project on its own. History (and any attachment) is kept only in this tab — it's not saved anywhere, unless
 * you explicitly turn it into something: "💾 Save as Reel template" drafts a real Template from the conversation
 * (hands off to the Templates page's existing "review the AI draft, then save" flow) so it can be picked when
 * creating any new Reel — see lib/templateDraftHandoff.ts for how that hand-off works.
 *
 * You can attach a file: images and video (a few sampled frames) are things the AI can actually look at, if the
 * chosen model supports vision; audio gets real beat/tempo/energy analysis — the same analysis Beat Sync uses to
 * cut video on the beat, with real timestamps (not transcribed — no speech-to-text is wired up, so lyrics/spoken
 * words are never read); PDFs and text/code files have their text read in.
 */
export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState<{ id: string; name: string }[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const send = useMutation({
    mutationFn: (next: ChatMessage[]) => api.chat(next),
  });

  const saveTemplate = useMutation({
    mutationFn: () => api.generateTemplateFromChat(transcript(messages)),
    onSuccess: (r) => {
      stashTemplateDraft(r.template);
      router.push("/templates");
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, send.isPending, uploading.length]);

  const pendingImages = attachments.flatMap((a) => a.images);
  const fileBlocks = attachments.filter((a) => a.text).map((a) => fileBlock(a));
  const combinedLen = [...fileBlocks, text.trim()].filter(Boolean).join("\n\n").length;
  const tooManyImages = pendingImages.length > MAX_IMAGES_PER_MESSAGE;
  const tooLong = combinedLen > MAX_MESSAGE_LEN;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !send.isPending && uploading.length === 0 && !tooManyImages && !tooLong;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachError(null);
    for (const f of Array.from(files)) {
      const id = `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploading((u) => [...u, { id, name: f.name }]);
      try {
        const result = await api.uploadChatFile(f);
        setAttachments((a) => [...a, { ...result, id }]);
      } catch (err) {
        setAttachError(`${f.name}: ${errorMessage(err)}`);
      } finally {
        setUploading((u) => u.filter((x) => x.id !== id));
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((a) => a.filter((x) => x.id !== id));
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    const typed = text.trim();
    const content = [...fileBlocks, typed].filter(Boolean).join("\n\n") || "Please look at what I attached.";
    const userMsg: DisplayMessage = {
      role: "user",
      content,
      images: pendingImages,
      displayText: typed,
      attachments: attachments.length ? attachments : undefined,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setText("");
    setAttachments([]);
    sendConversation(next);
  }

  function sendConversation(next: DisplayMessage[]) {
    const wire: ChatMessage[] = next.map((m) => ({ role: m.role, content: m.content, images: m.images }));
    send.mutate(wire, {
      onSuccess: (r) => setMessages((cur) => [...cur, { role: "assistant", content: r.reply }]),
      // on error the user's message (and its attachments) stay in the list; ErrorBanner explains what happened
    });
  }

  function retry() {
    if (messages.length === 0 || send.isPending) return;
    sendConversation(messages);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <>
      <PageHeader title="Chat" subtitle="Ask questions or think out loud with the AI. Nothing here changes any project." />

      <Card className="flex h-[70vh] flex-col p-0">
        <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-label="Conversation" role="log">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Ask about pacing, styles, captions, music choices, shot order — anything you want to think through first, or attach a file (image,
                video, audio, PDF, text/code) with the paperclip below. It can&apos;t generate or animate video/images and can&apos;t see your
                project footage unless you attach it here. Once you&apos;re happy with a direction, &quot;💾 Save as Reel template&quot; below turns
                it into a real, reusable template you can review and start any new Reel from.
              </p>
              <div className="flex flex-wrap gap-2" aria-label="Ideas">
                {IDEAS.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setText(i)}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-accent/60 hover:text-foreground"
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] space-y-2 rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "bg-accent text-white" : "bg-surface-2 text-foreground"}`}>
                {m.attachments && m.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.attachments.map((a) => (
                      <AttachmentChip key={a.id} file={a} tone={m.role === "user" ? "on-accent" : "default"} />
                    ))}
                  </div>
                )}
                {(m.displayText ?? m.content) && <p className="whitespace-pre-wrap">{m.displayText ?? m.content}</p>}
              </div>
            </div>
          ))}
          {send.isPending && (
            <div className="flex justify-start" aria-live="polite">
              <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                </span>
                Thinking…
              </div>
            </div>
          )}
          {send.isError && <ErrorBanner message={errorMessage(send.error)} onRetry={retry} />}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="space-y-2 border-t border-border p-3">
          {(attachments.length > 0 || uploading.length > 0 || attachError) && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <AttachmentChip key={a.id} file={a} tone="default" onRemove={() => removeAttachment(a.id)} />
                ))}
                {uploading.map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
                    {u.name}
                  </span>
                ))}
              </div>
              {attachError && <p className="text-xs text-danger">{attachError}</p>}
              {tooManyImages && <p className="text-xs text-danger">At most {MAX_IMAGES_PER_MESSAGE} images (a video counts its sampled frames) in one message.</p>}
              {tooLong && <p className="text-xs text-danger">That&apos;s too much text for one message ({combinedLen.toLocaleString()} / {MAX_MESSAGE_LEN.toLocaleString()} characters) — try a shorter file or message.</p>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              aria-label="Attach files"
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach a file"
              title="Attach a file"
              onClick={() => fileInputRef.current?.click()}
              className="mb-0.5 rounded-xl border border-border px-3 py-2 text-sm text-muted hover:border-accent/60 hover:text-foreground"
            >
              📎
            </button>
            <textarea
              aria-label="Message"
              rows={1}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask anything… (Enter to send, Shift+Enter for a new line)"
              className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button type="submit" disabled={!canSend} className={btnPrimary}>
              {send.isPending ? "Sending…" : "Send"}
            </button>
            {messages.some((m) => m.role === "assistant") && (
              <button
                type="button"
                title="Turn this conversation into a reusable Reel template — you review it before anything is saved"
                className={btnSecondary}
                disabled={send.isPending || saveTemplate.isPending}
                onClick={() => saveTemplate.mutate()}
              >
                {saveTemplate.isPending ? "Drafting…" : "💾 Save as Reel template"}
              </button>
            )}
            {messages.length > 0 && (
              <button
                type="button"
                className={btnSecondary}
                disabled={send.isPending}
                onClick={() => {
                  setMessages([]);
                  setAttachments([]);
                  send.reset();
                  saveTemplate.reset();
                }}
              >
                Clear
              </button>
            )}
          </div>
          {saveTemplate.isError && <ErrorBanner message={errorMessage(saveTemplate.error)} />}
        </form>
      </Card>
    </>
  );
}

/** The conversation as plain "role: text" lines for the AI to read back when drafting a template — typed text only
 * (not the raw file dumps folded into `content`), and capped to the backend's limit, keeping the most recent part. */
function transcript(messages: DisplayMessage[]): string {
  const full = messages
    .map((m) => `${m.role}: ${(m.displayText ?? m.content).trim()}`)
    .filter((line) => !line.endsWith(":"))
    .join("\n");
  return full.length > MAX_TRANSCRIPT_CHARS ? full.slice(-MAX_TRANSCRIPT_CHARS) : full;
}

function fileBlock(a: Attachment): string {
  const note = a.truncated ? "\n[...truncated...]" : "";
  return `[Attached file: ${a.name}]\n${a.text}${note}\n[End of ${a.name}]`;
}

function AttachmentChip({ file, tone, onRemove }: { file: Attachment | ChatFile; tone: "default" | "on-accent"; onRemove?: () => void }) {
  const thumb = file.kind === "image" || file.kind === "video" ? file.images[0] : undefined;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${
        tone === "on-accent" ? "border-white/30 bg-white/10 text-white" : "border-border bg-surface-2 text-foreground"
      }`}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small base64 thumbnail, not a served asset
        <img src={`data:image/jpeg;base64,${thumb}`} alt="" className="h-4 w-4 rounded-sm object-cover" />
      ) : (
        <span aria-hidden>{KIND_ICON[file.kind]}</span>
      )}
      <span className="max-w-[10rem] truncate">{file.name}</span>
      <span className="opacity-70">{formatBytes(file.sizeBytes)}</span>
      {onRemove && (
        <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} className="opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </span>
  );
}
