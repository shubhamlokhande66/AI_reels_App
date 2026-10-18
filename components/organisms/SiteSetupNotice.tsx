"use client";

import { missingSite, useSite } from "@/components/molecules/Legal";

/** Administration: the business details still missing on the server. People never see placeholders; the Contact,
 * Privacy, Terms and Refunds pages leave them out. Payment providers (Razorpay) ask for a real email and address. */
export function SiteSetupNotice() {
  const missing = missingSite(useSite().data);
  if (!missing.length) return null;
  return (
    <section className="card" aria-label="Business details" style={{ borderColor: "var(--warning)" }}>
      <span className="h2">Business details to set</span>
      <span className="mu sm">Add these to the server settings (environment), then restart. Until then the Contact, Privacy, Terms and Refunds pages leave them out.</span>
      <ul className="flex flex-col gap-1 text-sm">
        {missing.map((m) => (
          <li key={m}>
            <code>{m.split(" ")[0]}</code> <span className="mu">{m.slice(m.indexOf(" ") + 1)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
