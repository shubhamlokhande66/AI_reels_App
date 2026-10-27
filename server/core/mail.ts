import "server-only";
import nodemailer from "nodemailer";
import { settings } from "@/server/core/config";
import { mainDb, ObjectId } from "@/server/core/db";

/** Whether the notes about invites, credits and affiliates are emailed (Admin → Marketing → Emails; on unless switched
 * off). The codes (sign-up, password) are always sent. */
async function notesOn() {
  const m = await (await mainDb()).collection("app_settings").findOne({ _id: "marketing" as unknown as ObjectId }, { projection: { emails: 1 } });
  return (m?.emails as { notes?: boolean } | undefined)?.notes !== false;
}

/** The site's address for links in emails (PUBLIC_BASE_URL). */
export const siteUrl = () => (settings.publicBaseUrl || "http://localhost:3100").replace(/\/+$/, "");

type Smtp = { name: string; host: string; port: number; user: string; pass: string; from: string; ssl: boolean };
/** The email services, in order: SMTP_* first (e.g. Gmail), then SMTP_FALLBACK_* (e.g. Brevo) when the first one fails. */
const services = (): Smtp[] => {
  const s = settings;
  return [
    { name: "main", host: s.smtpHost, port: s.smtpPort, user: s.smtpUser, pass: s.smtpPassword, from: s.smtpFrom, ssl: s.smtpSsl },
    { name: "fallback", host: s.smtpFallbackHost, port: s.smtpFallbackPort, user: s.smtpFallbackUser, pass: s.smtpFallbackPassword, from: s.smtpFallbackFrom || s.smtpFrom, ssl: s.smtpFallbackSsl },
  ].filter((x) => x.host && x.from);
};
/** Email over SMTP: the main service, else the fallback one; without any, the message is written to the server log
 * (a local install still works). */
export async function sendMail(to: string, subject: string, text: string, html?: string, opts: { replyTo?: string } = {}): Promise<boolean> {
  const list = services();
  if (!list.length) {
    // the message (a code is a key to the account) is shown only while developing, never in a live server's log
    console.warn(`email is not set up (SMTP_HOST / SMTP_FROM); would have sent to ${to}: ${subject}${process.env.NODE_ENV === "production" ? "" : `\n${text}`}`);
    return false;
  }
  for (const sv of list) {
    const m = /^(.*)<([^>]+)>\s*$/.exec(sv.from), name = (m?.[1] ?? "").trim().replace(/^"|"$/g, "") || settings.businessName, addr = (m?.[2] ?? sv.from).trim();
    try {
      const t = nodemailer.createTransport({ host: sv.host, port: sv.port, secure: sv.ssl, requireTLS: !sv.ssl, auth: sv.user ? { user: sv.user, pass: sv.pass } : undefined, connectionTimeout: 20_000, greetingTimeout: 15_000 });
      await t.sendMail({ from: { name, address: addr }, to, subject, text, ...(html ? { html } : {}), ...(opts.replyTo ? { replyTo: opts.replyTo } : {}) });
      return true;
    } catch (e) { console.warn(`email to ${to} via the ${sv.name} service (${sv.host}) failed: ${(e as Error).message}`); } // then the next one
  }
  return false;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------------------------------------------------------------- the emails' look (one frame for every email)
// Ivory card, a deep aubergine header with the wordmark in spaced capitals, a serif title, hairline rules, a quiet footer.
// Tables and inline styles only (what Gmail, Outlook and Apple Mail all show the same); no pictures to load.
const INK = "#16121f", BODY = "#4a4458", SOFT = "#8a8398", RULE = "#ece7f3", ACCENT = "#8b5cf6", GOLD = "#c9a86a";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif", SERIF = "Georgia,'Times New Roman',serif", MONO = "'SF Mono',Menlo,Consolas,'Courier New',monospace";
/** The frame: `preheader` is the grey line inboxes show after the subject; `body` is rows (<tr>…</tr>) inside the card. */
export function frame(preheader: string, body: string, footerExtra = "") {
  const b = esc(settings.businessName), host = esc(siteUrl().replace(/^https?:\/\//, ""));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${b}</title></head>
<body style="margin:0;padding:0;background:#f3f0f7;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0f7"><tr><td align="center" style="padding:36px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdfa;border-radius:20px;overflow:hidden;border:1px solid ${RULE}">
<tr><td style="background:#1a1326;background-image:linear-gradient(135deg,#1a1326 0%,#2a1840 60%,#3b1d5c 100%);padding:26px 34px" align="left">
<span style="font-family:${SANS};font-size:13px;font-weight:700;letter-spacing:.42em;color:#ffffff">${b.toUpperCase()}</span>
<span style="display:inline-block;width:22px;height:1px;background:${GOLD};vertical-align:middle;margin-left:12px"></span>
</td></tr>
<tr><td style="padding:38px 34px 10px 34px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>
<tr><td style="padding:0 34px"><div style="height:1px;background:${RULE};line-height:1px;font-size:0">&nbsp;</div></td></tr>
<tr><td style="padding:20px 34px 30px 34px;font-family:${SANS};font-size:11.5px;line-height:1.6;color:${SOFT}">
${footerExtra ? `${footerExtra}<br>` : ""}${b} · <a href="${esc(siteUrl())}" style="color:${SOFT};text-decoration:underline">${host}</a><br>This is an automated email; replies are not read.
</td></tr></table>
</td></tr></table></body></html>`;
}
const row = (html: string, pad = "0 0 18px 0") => `<tr><td style="padding:${pad}">${html}</td></tr>`;
const eyebrow = (s: string) => row(`<span style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:${ACCENT}">${esc(s)}</span>`, "0 0 12px 0");
const heading = (s: string) => row(`<h1 style="margin:0;font-family:${SERIF};font-size:28px;line-height:1.2;font-weight:400;color:${INK};letter-spacing:-.01em">${esc(s)}</h1>`, "0 0 14px 0");
const para = (s: string) => row(`<p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.65;color:${BODY}">${esc(s)}</p>`, "0 0 24px 0");
const note = (s: string) => row(`<p style="margin:0;font-family:${SANS};font-size:12.5px;line-height:1.6;color:${SOFT}">${esc(s)}</p>`, "0 0 22px 0");
const button = (label: string, href: string) => row(`<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:${INK}">
<a href="${esc(href)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:14px;font-weight:600;letter-spacing:.04em;color:#ffffff;text-decoration:none;border-radius:999px">${esc(label)}&nbsp;&nbsp;&rarr;</a></td></tr></table>`, "0 0 26px 0");
export const mailParts = { row, eyebrow, heading, para, note, button, INK, BODY, SOFT, RULE, ACCENT, GOLD, SANS, SERIF, MONO };

/** A short branded email: the title, a line, one button, a note under it; and the same as plain text. */
export function letter(title: string, line: string, buttonLabel: string, link: string, n: string): { text: string; html: string } {
  const html = frame(line, heading(title) + para(line) + button(buttonLabel, link) + note(n)
    + row(`<p style="margin:0;font-family:${SANS};font-size:11.5px;line-height:1.6;color:${SOFT}">If the button does not work, open this link:<br><a href="${esc(link)}" style="color:${ACCENT};word-break:break-all">${esc(link)}</a></p>`, "0 0 22px 0"));
  return { text: `${title}\n\n${line}\n\n${buttonLabel}: ${link}\n\n${n}\n`, html };
}

/** A one-time code email: an eyebrow, the title, a line, the 6 digits in their own tiles (and once more as plain text, easy
 * to copy), how long it works; and the same as plain text. */
export function codeLetter(title: string, line: string, code: string, n: string, kicker = "Your code"): { text: string; html: string } {
  const tiles = code.split("").map((d) => `<td align="center" style="width:46px;height:58px;border:1px solid ${RULE};border-radius:12px;background:#ffffff;font-family:${MONO};font-size:28px;font-weight:600;color:${INK}">${esc(d)}</td>`)
    .join(`<td style="width:8px;font-size:0">&nbsp;</td>`);
  const codeBlock = row(`<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f7f3fc;border-radius:16px;padding:18px 18px"><tr><td>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${tiles}</tr></table></td></tr></table>`, "0 0 12px 0")
    + row(`<p style="margin:0;font-family:${SANS};font-size:12px;color:${SOFT}">or copy&nbsp; <span style="font-family:${MONO};font-size:13px;font-weight:600;letter-spacing:.12em;color:${INK}">${esc(code)}</span></p>`, "0 0 26px 0");
  const html = frame(`${code} is your code. ${line}`, eyebrow(kicker) + heading(title) + para(line) + codeBlock + note(n));
  return { text: `${title}\n\n${line}\n\n${code}\n\n${n}\n`, html };
}

/** A short branded email to one account (by id), never failing the caller: a note about their invites, credits or
 * affiliate earnings. `path`: the page the button opens ("/affiliate"). */
export async function mailUser(userId: string, subject: string, title: string, line: string, button: string, path: string, note = "") {
  try {
    if (!(await notesOn())) return false; // Admin → Marketing → Emails: the notes are switched off
    if (!ObjectId.isValid(userId)) return false;
    const u = await (await mainDb()).collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { email: 1 } });
    if (!u?.email) return false;
    const m = letter(title, line, button, siteUrl() + path, note || `You get this email because you have a ${settings.businessName} account.`);
    return await sendMail(String(u.email), subject, m.text, m.html);
  } catch { return false; }
}
/** The administrators (ADMIN_EMAILS and Admin → Settings → Administrators), for things they need to act on (a new affiliate to approve). */
export async function mailAdmins(subject: string, title: string, line: string, button: string, path: string) {
  if (!(await notesOn())) return false;
  const to = await (await import("./admin")).adminEmails(); // the owners (ADMIN_EMAILS) and the ones added in the app
  if (!to.length) return false;
  const m = letter(title, line, button, siteUrl() + path, "You get this email because you are an administrator.");
  try { return await sendMail(to.join(", "), subject, m.text, m.html); } catch { return false; }
}
