"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { btnPrimary, Card, ErrorBanner, PageHeader } from "@/components/ui";
import { TaskLog } from "@/components/TaskLog";

const LANGS = [
  ["hi", "हिन्दी Hindi"],
  ["en", "English"],
  ["mr", "मराठी Marathi"],
  ["hinglish", "Hinglish"],
] as const;
const LENGTHS = [
  [30, "30 s", 5],
  [60, "1 min", 8],
  [90, "1.5 min", 11],
] as const;
const EXAMPLE =
  "कुरुक्षेत्र के मैदान में दोनों सेनाएँ आमने-सामने खड़ी थीं। अर्जुन ने अपने गुरुओं और भाइयों को सामने देखा, और उसका मन काँप उठा। उसका गांडीव धनुष हाथ से छूट गया। तब श्रीकृष्ण मुस्कुराए और बोले, हे पार्थ, कर्म करो, फल की चिंता मत करो। आत्मा अमर है। अर्जुन ने फिर से धनुष उठाया, और धर्म के मार्ग पर चल पड़ा।";

/** Story -> Reel, step 1: the story, its language, the look and the length. The AI turns it into scenes. */
export default function NewStoryPage() {
  const router = useRouter();
  const options = useQuery({ queryKey: ["story-options"], queryFn: api.storyOptions });
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("hi");
  const [artStyle, setArtStyle] = useState("ravi_varma");
  const [length, setLength] = useState<number>(60);
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const scenes = LENGTHS.find((l) => l[0] === length)?.[2] ?? 8;
      return api.createStory({ text: text.trim(), language, artStyle, scenes, seconds: length });
    },
    onSuccess: (s) => router.push(`/projects/${s.projectId}`),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const t = text.trim();
    if (t.length < 40) return setFormError("Write a little more of the story (at least a few sentences).");
    if (t.length > 12000) return setFormError("The story is too long (12,000 characters at most). Use one chapter at a time.");
    create.mutate();
  }

  const style = options.data?.artStyles.find((s) => s.id === artStyle);

  return (
    <>
      <PageHeader title="Story → Reel" subtitle="Paste a story. The AI splits it into scenes, finds a picture for each, and a narrator tells it." />
      <form onSubmit={submit} className="space-y-6">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor="story" className="font-medium">
              Your story
            </label>
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setText(EXAMPLE)} disabled={create.isPending}>
              Try an example (Gita)
            </button>
          </div>
          <textarea
            id="story"
            rows={9}
            value={text}
            maxLength={12000}
            disabled={create.isPending}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. The story of Arjuna at Kurukshetra…"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 leading-relaxed outline-none focus:border-accent"
          />
          <p className="text-right text-xs text-muted">{text.length.toLocaleString()} / 12,000</p>
        </Card>

        <Card className="space-y-4">
          <div>
            <p className="mb-2 font-medium">Look</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(options.data?.artStyles ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={create.isPending}
                  onClick={() => setArtStyle(s.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                    artStyle === s.id ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent/60"
                  }`}
                >
                  <span className="block font-medium">{s.name}</span>
                  <span className="text-xs text-muted">{s.paintings ? "Real classical paintings first" : "AI pictures"}</span>
                </button>
              ))}
            </div>
            {style && options.data && (
              <p className="mt-2 text-xs text-muted">
                {style.paintings ? "Public-domain paintings (free) are used where they fit; " : ""}
                {options.data.freeAi || options.data.paidAi
                  ? "AI pictures fill the other scenes."
                  : "AI pictures are not connected yet: you can upload your own picture for any scene."}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Narration language</span>
              <select
                value={language}
                disabled={create.isPending}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2"
              >
                {LANGS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              <span className="mb-1.5 block font-medium">Length</span>
              <div className="flex gap-2">
                {LENGTHS.map(([v, l, n]) => (
                  <button
                    key={v}
                    type="button"
                    disabled={create.isPending}
                    onClick={() => setLength(v)}
                    className={`flex-1 rounded-xl border px-3 py-2 transition ${length === v ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent/60"}`}
                  >
                    {l}
                    <span className="block text-[11px] text-muted">~{n} scenes</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {(formError || create.error) && <ErrorBanner message={formError ?? errorMessage(create.error)} />}
        <button type="submit" className={`${btnPrimary} w-full py-3 sm:w-auto`} disabled={create.isPending || options.isLoading}>
          {create.isPending ? "Writing the scenes…" : "✦ Turn it into scenes"}
        </button>
      </form>
      {create.isPending && (
        <TaskLog
          onClose={() => {}}
          log={{
            title: "Planning your story",
            state: "running",
            progress: null,
            barKey: "plan",
            lines: [{ id: "plan", text: "Reading the story and writing the scenes: a narration line and a picture idea for each…", status: "running" }],
          }}
        />
      )}
    </>
  );
}
