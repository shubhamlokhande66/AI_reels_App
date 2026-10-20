"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DEFAULT_TEMPLATES, type StudioTemplate } from "@/lib/studio-templates";

const KEY = "brs-templates";
/** the templates people see (the administrator's list, today's): the defaults first, then the server's list (also kept in
 * localStorage, so the next visit starts with it). `ready` once the server answered or failed. */
export function useTemplates() {
  const [list, setList] = useState<StudioTemplate[]>(() => DEFAULT_TEMPLATES.filter((t) => t.on && !t.showFrom && !t.showTo));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    try { const c = JSON.parse(localStorage.getItem(KEY) || "null"); if (Array.isArray(c?.templates)) setList(c.templates); } catch {}
    api.templates().then((r) => { if (!live || !Array.isArray(r?.templates)) return; setList(r.templates); try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), templates: r.templates })); } catch {} })
      .catch(() => {}).finally(() => live && setReady(true));
    return () => { live = false; };
  }, []);
  return { templates: list, ready };
}
