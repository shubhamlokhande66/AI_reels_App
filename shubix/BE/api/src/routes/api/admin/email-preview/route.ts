import { requireAdmin } from "../../../../server/core/admin";
import { route } from "../../../../server/core/http";
import { codeLetter, letter } from "../../../../server/core/mail";
import { settings } from "../../../../server/core/config";
import { receiptLetter } from "../../../../server/receipts";
import { getSite } from "../../../../server/site";

/** Admin: how the emails look (?kind=verify | reset | note | receipt), with sample details; nothing is sent. */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const kind = new URL(req.url).searchParams.get("kind") ?? "verify", b = settings.businessName;
  if (kind === "receipt") {
    const r = receiptLetter({ no: "SHU-2026-000042", at: new Date(), email: "riya@example.com", label: "Editor plan · 1 month", kind: "plan", base: 199,
      offer: { title: "Diwali sale", off: 40 }, coupon: { code: "WELCOME10", off: 16 }, total: 143, paymentId: "pay_PZ8sample123", orderId: "order_PZ8sample456",
      got: "Your Editor plan is active until 26 November 2026.", balance: 250, site: await getSite() });
    return new Response(r.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const m = kind === "reset"
    ? codeLetter("Reset your password", `We received a request to reset the password of your ${b} account. Enter this code in the app to choose a new one.`, "482917",
      "The code works for 10 minutes. If you did not ask for this, ignore this email: your password stays the same.", "Password reset")
    : kind === "note"
      ? letter("20 credits for inviting @riya", "@riya made a first purchase, so 20 credits were added to your account. Keep sharing your link to earn more.", "Invite more friends", "/rewards", `You get this email because you have a ${b} account.`)
      : codeLetter("Confirm your email", `Welcome to ${b}. Enter this code in the app to confirm your email address and finish setting up your account.`, "482917",
        `The code works for 10 minutes. If you did not create a ${b} account, you can safely ignore this email.`, "Email verification");
  return new Response(m.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
});
