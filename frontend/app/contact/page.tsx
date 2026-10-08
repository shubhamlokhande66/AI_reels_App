"use client";

import { LegalPage } from "@/components/Legal";

export default function ContactPage() {
  return (
    <LegalPage title="Contact us">
      {(s) => (
        <>
          <p>We are happy to help with your account, payments, refunds or anything about your Reels.</p>
          <div className="lux-card grid gap-4 rounded-3xl p-6 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted">Email</p>
              {s.email.startsWith("[") ? <p>{s.email}</p> : <a href={`mailto:${s.email}`} className="text-accent hover:underline">{s.email}</a>}
            </div>
            {s.phone && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted">Phone</p>
                <a href={`tel:${s.phone.replace(/\s+/g, "")}`} className="text-accent hover:underline">{s.phone}</a>
              </div>
            )}
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wider text-muted">Address</p>
              <p>
                {s.name}
                <br />
                {s.address}
              </p>
            </div>
          </div>
          <p className="text-sm text-muted">We answer within 3 working days. For a payment question, include the payment date and amount.</p>
        </>
      )}
    </LegalPage>
  );
}
