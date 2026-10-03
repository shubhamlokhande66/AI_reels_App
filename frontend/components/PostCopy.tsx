"use client";

import { useState } from "react";
import type { PostCopyData } from "@/types/api";
import { btnSecondary, Card } from "./ui";

interface Props {
  copy: PostCopyData;
}

async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; /* clipboard unavailable (insecure context); the text stays selectable */
  }
}

/** Post copy with a one-click copy of the full caption. Instagram Reels add a line asking for the send and alt text. */
export function PostCopy({ copy }: Props) {
  const [copied, setCopied] = useState<"caption" | "alt" | null>(null);
  const tags = copy.hashtags.map((h) => `#${h}`).join(" ");
  const full = [copy.title, copy.description, copy.sendPrompt, tags].filter(Boolean).join("\n\n");

  async function onCopy(what: "caption" | "alt", text: string) {
    if (await toClipboard(text)) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    }
  }

  return (
    <Card className="mt-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{copy.platform === "instagram" ? "Instagram caption" : "Post copy"}</h2>
        <button type="button" onClick={() => onCopy("caption", full)} className={btnSecondary}>
          {copied === "caption" ? "Copied ✓" : "Copy caption"}
        </button>
      </div>
      {copy.title && <p className="mt-3 text-lg font-medium">{copy.title}</p>}
      {copy.description && <p className="mt-1 text-sm text-foreground/90">{copy.description}</p>}
      {copy.sendPrompt && <p className="mt-2 text-sm text-foreground/90">{copy.sendPrompt}</p>}
      {tags && <p className="mt-2 text-sm text-accent">{tags}</p>}
      {copy.altText && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Alt text</p>
            <button type="button" onClick={() => onCopy("alt", copy.altText ?? "")} className="text-xs text-accent hover:underline">
              {copied === "alt" ? "Copied ✓" : "Copy alt text"}
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">{copy.altText}</p>
          <p className="mt-1 text-xs text-muted">Paste it under Advanced settings → Accessibility when you post: Instagram search reads it too.</p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        {copy.source === "template"
          ? "A plain template from your project name and instructions (turn on AI assist for written copy). Edit it before posting."
          : "Written by the AI from your project details. Review before posting."}
      </p>
    </Card>
  );
}
