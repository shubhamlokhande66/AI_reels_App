// The studio's markup in each real state, as page snapshots for the CSS → Tailwind rebuild (scripts/studio-css/README.md).
//   npx tsx scripts/studio-css/snaps.mts <out dir>
import fs from "node:fs";
import path from "node:path";
import { STUDIO_HTML } from "../../components/studio/markup";

/** root classes and data of each state the engine really sets (views.ts apply / onChange, flow.ts apply) */
const STATES: Record<string, { cls: string; data?: Record<string, string>; made?: boolean }> = {
  intro: { cls: "fopen", data: { fstep: "intro", fkind: "music" } },
  choose: { cls: "fopen", data: { fstep: "choose", fkind: "music" } },
  adjust: { cls: "fopen", data: { fstep: "adjust", fkind: "music" } },
  clips: { cls: "fopen", data: { fstep: "clips", fkind: "music" } },
  analyse: { cls: "fopen", data: { fstep: "analyse", fkind: "music" } },
  editor: { cls: "made noir editing", made: true },
  review: { cls: "made noir review", made: true },
  opening: { cls: "opening" },
};
const out = process.argv[2] ?? "snaps";
fs.mkdirSync(out, { recursive: true });
for (const [name, s] of Object.entries(STATES)) for (const [w, phone] of [[1280, false], [390, true]] as const) {
  const cls = ["brs", "v-one", s.cls, phone && s.made ? "fpost" : ""].filter(Boolean).join(" ");
  const data = Object.entries(s.data ?? {}).map(([k, v]) => ` data-${k}="${v}"`).join("");
  let html = STUDIO_HTML;
  if (s.made) html = html.replace('class="step locked editor" id="s3"', 'class="step editor" id="s3"');
  // the app around the studio (components/templates/AppShell.tsx): .rm > main > the page
  const page = `<!doctype html><html lang="en"><body><div class="rm"><main><div><div><div class="${cls}"${data}>${html}</div></div></div></main></div></body></html>`;
  fs.writeFileSync(path.join(out, `${phone ? "p" : "d"}-${name}.html`), page);
}
console.log("snapshots in", out);
