"use client";

import { useState } from "react";
import { btnSecondary, Card } from "./ui";

interface Props {
  copy: { title: string; description: string; hashtags: string[] };
}

/** AI-written post copy with a one-click copy of the full caption. */
export function PostCopy({ copy }: Props) {
  const [copied, setCopied] = useState(false);
  const tags = copy.hashtags.map((h) => `#${h}`).join(" ");
  const full = [copy.title, copy.description, tags].filter(Boolean).join("\n\n");

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context); the text stays selectable */
    }
  }

  return (
    <Card className="mt-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">Post copy</h2>
        <button type="button" onClick={onCopy} className={btnSecondary}>
          {copied ? "Copied ✓" : "Copy caption"}
        </button>
      </div>
      {copy.title && <p className="mt-3 text-lg font-medium">{copy.title}</p>}
      {copy.description && <p className="mt-1 text-sm text-foreground/90">{copy.description}</p>}
      {tags && <p className="mt-2 text-sm text-accent">{tags}</p>}
      <p className="mt-3 text-xs text-muted">Written by the AI from your project details. Review before posting.</p>
    </Card>
  );
}
