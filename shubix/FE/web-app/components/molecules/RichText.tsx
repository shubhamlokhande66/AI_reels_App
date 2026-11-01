import Link from "next/link";
import { Fragment } from "react";

/** A long text the administrator writes (Admin → CMS), shown as a page: a line starting "## " is a heading,
 * lines starting "- " make a list, a blank line starts a new paragraph; inside a line **bold** and [a link](/refunds). */
const SAFE_LINK = /^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i;
function inline(s: string, key: string) {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;
  let at = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > at) out.push(s.slice(at, m.index));
    if (m[1]) out.push(<strong key={`${key}b${i++}`}>{m[1]}</strong>);
    else if (!SAFE_LINK.test(m[3])) out.push(m[2]); // only this site's pages, http(s), mail and phone links (no "javascript:" or "//elsewhere")
    else out.push(m[3].startsWith("/") ? <Link key={`${key}l${i++}`} href={m[3]} className="text-accent hover:underline">{m[2]}</Link> : <a key={`${key}l${i++}`} href={m[3]} target="_blank" rel="noreferrer" className="text-accent hover:underline">{m[2]}</a>);
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

export function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [], para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`} className="m-0 leading-relaxed">{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`} className="m-0 flex flex-col gap-1.5 pl-5">{list.map((li, i) => <li key={i} className="list-disc leading-relaxed">{inline(li, `u${blocks.length}-${i}`)}</li>)}</ul>);
    list = [];
  };
  const flush = () => { flushPara(); flushList(); };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) flush();
    else if (line.startsWith("## ")) { flush(); blocks.push(<h2 key={`h${blocks.length}`} className="m-0 mt-2 scroll-mt-20 font-[family-name:var(--font-display)] text-[17px] font-semibold">{line.slice(3)}</h2>); }
    else if (line.startsWith("- ")) { flushPara(); list.push(line.slice(2)); }
    else { flushList(); para.push(line); }
  }
  flush();
  return <>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</>;
}
