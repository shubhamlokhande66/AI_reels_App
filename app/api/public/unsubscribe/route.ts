import { route } from "@/server/core/http";
import { esc } from "@/server/core/mail";
import { settings } from "@/server/core/config";
import { unsubscribe } from "@/server/broadcasts";

/** "Stop these emails" in an announcement email (signed for that account): no more announcement emails. The bell and the
 * account emails (codes, receipts) stay. */
export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams, ok = await unsubscribe(q.get("u") ?? "", q.get("s") ?? "");
  const line = ok ? `You will not get ${settings.businessName} announcement emails any more. Codes, receipts and replies still come.` : "This link does not work. Open the newest email and try its link again.";
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(settings.businessName)} emails</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a1f;color:#f6f4ff;font:15px/1.6 system-ui,sans-serif;padding:24px"><main style="max-width:420px;text-align:center"><h1 style="font-size:22px">${ok ? "You are unsubscribed" : "Link not valid"}</h1><p style="color:#b9b5d6">${esc(line)}</p></main></body></html>`;
  return new Response(page, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
});
