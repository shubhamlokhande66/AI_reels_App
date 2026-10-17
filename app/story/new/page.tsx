"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { ErrorBanner, Hero } from "@/components/molecules";

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
    if (t.length < 40) return setFormError("Please write a little more: a few sentences at least.");
    if (t.length > 12000) return setFormError("The story is too long (12,000 characters at most). Use one chapter at a time.");
    create.mutate();
  }

  const style = options.data?.artStyles.find((s) => s.id === artStyle);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-[14px]">
      <Hero title="Turn a story into a Reel" subtitle="Scenes, a narrator's voice and music, made from your words." />
      <form onSubmit={submit} className="flex flex-col gap-[14px]">
        <label className="f" htmlFor="story">
          <span className="between">
            Your story
            <button type="button" className="ac font-bold" onClick={() => setText(EXAMPLE)} disabled={create.isPending}>
              Try an example
            </button>
          </span>
          <textarea
            id="story"
            value={text}
            maxLength={12000}
            disabled={create.isPending}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. The story of Arjuna at Kurukshetra…"
            className="ta"
            style={{ minHeight: 140 }}
          />
          <span className="text-right font-normal">{text.length.toLocaleString()} / 12,000</span>
        </label>
        <div className="g2">
          <label className="f">
            Narration language
            <select value={language} disabled={create.isPending} onChange={(e) => setLanguage(e.target.value)} className="inp">
              {LANGS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="f">
            Length
            <div className="tabs2" role="radiogroup" aria-label="Length">
              {LENGTHS.map(([v, l, n]) => (
                <button key={v} type="button" role="radio" aria-checked={length === v} title={`About ${n} scenes`} disabled={create.isPending} onClick={() => setLength(v)} className={length === v ? "on" : ""}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        {(options.data?.artStyles.length ?? 0) > 0 && (
          <div className="f">
            Look
            <div className="chips w" role="radiogroup" aria-label="Look">
              {options.data!.artStyles.map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={artStyle === x.id} disabled={create.isPending} onClick={() => setArtStyle(x.id)} className={`chip ${artStyle === x.id ? "on" : ""}`}>
                  {x.name}
                </button>
              ))}
            </div>
            {style && options.data && (
              <span className="font-normal">
                {style.paintings ? "Real classical paintings where they fit; " : ""}
                {options.data.freeAi || options.data.paidAi ? "AI pictures for the other scenes." : "you can add your own picture for any scene."}
              </span>
            )}
          </div>
        )}

        {(formError || create.error) && <ErrorBanner message={formError ?? errorMessage(create.error)} />}
        <button type="submit" className="btn g big" disabled={create.isPending || options.isLoading}>
          {create.isPending ? "Writing the scenes…" : "Create Story Reel"}
        </button>
      </form>
      {create.isPending && (
        <section className="card" aria-label="Task log">
          <div className="between">
            <span className="h2">Task log</span>
            <span className="mono sm mu">1 of 5</span>
          </div>
          <div className="chk cur">
            <span className="o" />
            Reading your story and writing the scenes…
          </div>
          {["Recording the narrator", "Choosing a picture for each scene", "Choosing music", "Putting the Reel together"].map((t) => (
            <div key={t} className="chk todo">
              <span className="o" />
              {t}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
