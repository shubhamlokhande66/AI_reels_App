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

/** Delete a draft from this phone: its entry and the files only it uses (a song or clip another draft or the recent
 * songs list still uses stays). The same rule as Fast Studio's own delete (components/studio/engine.ts deleteProject). */
export function deleteDraft(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open("brs-projects"); } catch (e) { return reject(e); }
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const dbx = req.result;
      const stores = ["meta", "files", "songs"].filter((n) => dbx.objectStoreNames.contains(n));
      if (!stores.includes("meta")) { dbx.close(); return resolve(); }
      const tx = dbx.transaction(stores, "readwrite");
      const meta = tx.objectStore("meta"), all = meta.getAll();
      all.onsuccess = () => {
        type St = { song?: { fp?: string }; clips?: { fp?: string }[]; settings?: { bg?: string }; vo?: { fp?: string } };
        const keysOf = (st: St = {}) => [st.song?.fp, ...(st.clips ?? []).map((c) => c.fp), st.settings?.bg, st.vo?.fp].filter(Boolean).map((fp) => "f:" + fp);
        const list = (all.result as (Draft & { state?: St })[]) ?? [];
        const used = new Set<string>(), mine = new Set<string>();
        for (const p of list) for (const k of keysOf(p.state)) (p.id === id ? mine : used).add(k);
        const finish = () => {
          if (stores.includes("files")) for (const k of mine) if (!used.has(k)) tx.objectStore("files").delete(k);
          meta.delete(id);
        };
        if (stores.includes("songs")) {
          const songs = tx.objectStore("songs").getAll();
          songs.onsuccess = () => { for (const sg of (songs.result as { fp?: string }[]) ?? []) if (sg.fp) used.add("f:" + sg.fp); finish(); };
          songs.onerror = finish;
        } else finish();
      };
      tx.oncomplete = () => { dbx.close(); resolve(); };
      tx.onerror = () => { dbx.close(); reject(tx.error); };
    };
  });
}
