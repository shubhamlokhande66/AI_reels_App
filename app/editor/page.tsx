"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { useProjects } from "@/hooks/useApi";
import { Icon, Spinner, Thumb } from "@/components/atoms";
import { ErrorBanner, Hero } from "@/components/molecules";

/** The manual editor's start (design: "Editor"): a new edit from scratch, or open one of your Reels to edit by hand. */
export default function EditorHome() {
  const router = useRouter();
  const projects = useProjects();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const p = await api.createProject(name.trim() || "My edit", { duration: 30 });
      router.push(`/editor/${p.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const editable = (projects.data ?? []).filter((p) => p.videoCount > 0); // Reels made from clips (not stories / product photos)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-[14px]">
      <Hero title="Make a Reel yourself" subtitle="Every professional tool, free: split, speed, transitions, titles, keyframes." />
      <form
        className="noir flex flex-col gap-4 rounded-[18px] bg-[#141210] p-[18px] text-[#f3ede3]"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <span className="row">
          <span className="it b4" style={{ background: "#1c1916" }}>
            <Icon name="scissors" size={20} />
          </span>
          <span className="flex flex-col">
            <b className="font-display text-[22px] font-semibold">Start a new edit</b>
            <span className="text-[12.5px] text-[#a69d90]">Add clips and music, cut by hand</span>
          </span>
        </span>
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Name your edit (optional)" className="inp" aria-label="Name your edit" />
        <button type="submit" className="btn g" disabled={busy}>
          {busy ? "Opening…" : "Open the editor"}
        </button>
        {error && <ErrorBanner message={error} />}
      </form>

      <h2 className="ht">Or edit one of your Reels</h2>
      {projects.isLoading ? (
        <Spinner label="Loading your Reels…" />
      ) : editable.length === 0 ? (
        <p className="mu sm">Reels you make from your clips will show up here.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-x-2 gap-y-2.5 sm:grid-cols-4 md:gap-x-3.5 lg:grid-cols-6">
          {editable.slice(0, 12).map((p) => (
            <li key={p.id}>
              <Link href={`/editor/${p.id}`} className="group flex flex-col gap-1">
                <Thumb id={p.id} url={p.thumbnailUrl} className="aspect-[3/4] w-full" />
                <b className="sm truncate group-hover:text-accent">{p.name}</b>
                <span className="mu xs">{p.duration < 60 ? `0:${String(p.duration).padStart(2, "0")}` : `${Math.floor(p.duration / 60)}:${String(p.duration % 60).padStart(2, "0")}`}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
