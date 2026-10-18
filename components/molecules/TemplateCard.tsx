import { photoClass } from "@/components/atoms";
import { templateHref, templateMeta, type StudioTemplate } from "@/lib/studio-templates";

/** the sample text, drawn the way the template puts it on the Reel */
function Sample({ s }: { s: StudioTemplate["sample"] }) {
  const base = "absolute inset-x-2 mx-auto w-fit max-w-[92%] text-center font-bold leading-tight";
  const style: React.CSSProperties = { top: `${s.y * 100}%`, fontSize: "clamp(9px, 2.6cqw + 4px, 13px)" };
  if (s.style === "box") return <span className={`${base} rounded-md px-1.5 py-0.5`} style={{ ...style, background: s.color, color: s.color === "#111111" ? "#fff" : "#1a140c" }}>{s.text}</span>;
  if (s.style === "tag") return <span className={`${base} rounded-full px-2 py-0.5`} style={{ ...style, background: s.color, color: "#1a140c" }}>{s.text}</span>;
  if (s.style === "neon") return <span className={base} style={{ ...style, color: s.color, textShadow: `0 0 8px ${s.color}, 0 0 2px #000` }}>{s.text}</span>;
  if (s.style === "clean") return <span className={`${base} font-semibold`} style={{ ...style, color: s.color, textShadow: "0 1px 3px rgba(0,0,0,.6)" }}>{s.text}</span>;
  return <span className={`${base} uppercase`} style={{ ...style, color: s.color, WebkitTextStroke: "0.6px #000", textShadow: "0 2px 0 #000" }}>{s.text}</span>;
}

/** A Fast Studio template: a little Reel with its text, its name and what it is; opens Fast Studio with it picked. */
export function TemplateCard({ t, compact = false }: { t: StudioTemplate; compact?: boolean }) {
  return (
    <a href={templateHref(t)} className="group flex min-w-0 flex-col gap-1.5" title={`Make a Reel with ${t.name}`}>
      <div className={`photo ${photoClass(t.id)} relative aspect-[9/16] w-full overflow-hidden transition-transform [container-type:inline-size] group-hover:scale-[1.015]`}>
        <Sample s={t.sample} />
        <span className="tag">{t.kind === "talk" ? "Talking" : t.len ? `${t.len} s` : "Music"}</span>
      </div>
      <b className="sm truncate group-hover:text-accent">{t.name}</b>
      {!compact && <span className="xs text-muted">{templateMeta(t)}</span>}
      {!compact && <span className="xs leading-snug text-muted line-clamp-2">{t.text}</span>}
    </a>
  );
}
