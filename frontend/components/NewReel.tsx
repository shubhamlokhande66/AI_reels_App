"use client";

import { useState } from "react";
import { CreateReelForm } from "./CreateReelForm";
import { ProductReelForm } from "./ProductReelForm";

type Kind = "edit" | "product";
const OPTIONS: { id: Kind; title: string; text: string }[] = [
  { id: "edit", title: "Edit my video clips", text: "Upload clips and a song; the app cuts them to the beat." },
  { id: "product", title: "Product Reel from photos", text: "Upload product photos; the app directs camera, light, text and transitions shot by shot." },
];

/** Choose what to make: a Reel cut from video clips, or one directed from product photos. */
export function NewReel() {
  const [kind, setKind] = useState<Kind>("edit");
  return (
    <div className="space-y-8">
      <div role="radiogroup" aria-label="What do you want to make?" className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={kind === o.id}
            onClick={() => setKind(o.id)}
            className={`rounded-2xl border p-4 text-left transition-colors ${kind === o.id ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"}`}
          >
            <span className="block font-medium">{o.title}</span>
            <span className="mt-1 block text-sm text-muted">{o.text}</span>
          </button>
        ))}
      </div>
      {kind === "edit" ? <CreateReelForm /> : <ProductReelForm />}
    </div>
  );
}
