"use client";

import { LegalPage } from "@/components/Legal";

export default function RefundsPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy">
      {(s) => (
        <>
          <h2>Cancellation</h2>
          <p>
            Plans do not renew automatically, so there is nothing to cancel: a plan simply ends at the end of the month or year you paid
            for. You keep using your credits until then.
          </p>

          <h2>Failed Reels</h2>
          <p>If a Reel cannot be made, the credits it used are returned to your account automatically. No request is needed.</p>

          <h2>Refunds</h2>
          <ul>
            <li>
              <strong>Unused purchase:</strong> if you have not used any credits from a plan or top-up, you can ask for a full refund within
              7 days of the payment.
            </li>
            <li>
              <strong>Charged by mistake:</strong> a duplicate payment, or a payment that did not give you your plan or credits, is refunded in full.
            </li>
            <li>Credits that were used to make Reels are not refundable.</li>
          </ul>

          <h2>How to ask</h2>
          <p>
            Write to {s.email} from your account&apos;s email with the payment date and amount. We answer within 3 working days.
            Approved refunds go back to the original payment method through Razorpay, usually within 5–7 working days.
          </p>

          <h2>Delivery</h2>
          <p>
            {s.name} is a digital service. Plans and credits are added to your account immediately after a successful payment; nothing is
            shipped.
          </p>
        </>
      )}
    </LegalPage>
  );
}
