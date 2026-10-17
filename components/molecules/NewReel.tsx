"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/atoms/Icon";
import { CreateReelForm } from "@/components/organisms/CreateReelForm";
import { ProductReelForm } from "@/components/organisms/ProductReelForm";
import { useFeatures } from "@/hooks/useApi";

type Kind = "edit" | "product";
const OPTIONS: { id: Kind; icon: string; tile: string; title: string; text: string }[] = [
  { id: "edit", icon: "video", tile: "b1", title: "Edit my video clips", text: "Upload clips and a song; we cut them to the beat" },
  { id: "product", icon: "bag", tile: "b2", title: "Product Reel from photos", text: "The AI directs every shot" },
];

/** Choose what to make (design: "Create a new Reel"): a Reel cut from video clips, or one directed from product photos. */
export function NewReel() {
  const params = useSearchParams();
  const features = useFeatures();
  const options = OPTIONS.filter((o) => (o.id === "edit" ? features.aiReel : features.productReel));
  const [picked, setKind] = useState<Kind>(() => (params.get("kind") === "product" ? "product" : "edit"));
  const kind: Kind = options.some((o) => o.id === picked) ? picked : options[0]?.id ?? "edit";
  return (
    <div className="flex flex-col gap-[14px]">
      {options.length > 1 && (
      <div role="radiogroup" aria-label="What do you want to make?" className="g2">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={kind === o.id} onClick={() => setKind(o.id)} className={`mk ${kind === o.id ? "on" : ""}`}>
            <span className={`it ${o.tile}`}>
              <Icon name={o.icon} size={20} />
            </span>
            <b>{o.title}</b>
            {kind === "edit" && <span>{o.text}</span>}
          </button>
        ))}
      </div>
      )}
      {kind === "edit" ? <CreateReelForm /> : <ProductReelForm />}
    </div>
  );
}
