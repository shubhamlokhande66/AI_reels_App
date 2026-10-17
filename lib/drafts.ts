"use client";

import { useEffect, useState } from "react";

/** A Reel being made in Fast Studio, kept on this phone (components/studio/engine.ts, IndexedDB "brs-projects"). */
export type Draft = { id: string; name: string; kind?: string; dur?: number; updated: number; thumb?: string };

/** Fast Studio's drafts on this phone, newest first; read only (the studio owns the store and creates it). */
export function useDrafts(): Draft[] | null {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  useEffect(() => {
    let live = true;
    const done = (d: Draft[]) => live && setDrafts(d);
    try {
      const req = indexedDB.open("brs-projects");
      req.onupgradeneeded = () => req.transaction?.abort(); // nothing saved yet: do not create the store here
      req.onerror = () => done([]);
      req.onsuccess = () => {
        const dbx = req.result;
        if (!dbx.objectStoreNames.contains("meta")) {
          dbx.close();
          return done([]);
        }
        const all = dbx.transaction("meta", "readonly").objectStore("meta").getAll();
        all.onsuccess = () => {
          done(((all.result as Draft[]) ?? []).sort((a, b) => b.updated - a.updated));
          dbx.close();
        };
        all.onerror = () => {
          done([]);
          dbx.close();
        };
      };
    } catch {
      done([]);
    }
    return () => {
      live = false;
    };
  }, []);
  return drafts;
}

export const clock = (s = 0) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
