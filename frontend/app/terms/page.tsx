"use client";

import Link from "next/link";
import { LegalPage } from "@/components/Legal";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      {(s) => (
        <>
          <p>
            These terms apply when you use {s.name} (&ldquo;we&rdquo;, &ldquo;the service&rdquo;), an online tool that edits short videos
            (Reels) from your clips, music, photos and stories. By creating an account or using the service you agree to them.
          </p>

          <h2>1. Your account</h2>
          <ul>
            <li>You must be at least 18, or have a parent&apos;s or guardian&apos;s permission.</li>
            <li>Keep your password safe. You are responsible for what happens in your account.</li>
            <li>You can delete your account and all its data at any time from the Account page.</li>
          </ul>

          <h2>2. Your content</h2>
          <ul>
            <li>You keep all rights to the clips, music, photos and text you upload, and to the Reels made from them.</li>
            <li>
              You confirm you have the rights to everything you upload, including music. Do not upload content that is illegal,
              hateful, sexual involving minors, or that infringes someone else&apos;s rights.
            </li>
            <li>
              You allow us to process your content only to provide the service (analyse it, edit it, store it for the time shown in the
              app, and post it where you ask us to).
            </li>
            <li>Uploaded files are deleted automatically after a period shown in the app. Download your Reels before then.</li>
          </ul>

          <h2>3. AI features</h2>
          <ul>
            <li>
              Some features use AI services (for example to plan scenes, write captions, make a voice or a picture). AI output can be
              wrong or imperfect: check your Reel before you post it.
            </li>
            <li>Pictures from public-domain artworks are credited in the app. AI pictures and voices may be used for your Reels freely.</li>
          </ul>

          <h2>4. Plans, credits and payments</h2>
          <ul>
            <li>Prices are in Indian rupees and include GST. Payments are processed by Razorpay.</li>
            <li>
              Paid plans are prepaid for one month or one year and do <strong>not</strong> renew automatically. Plan credits refresh every 30
              days during the paid period and do not carry over; starter and top-up credits do not expire.
            </li>
            <li>Credits are used when a Reel is made. If a Reel fails, its credits are returned automatically.</li>
            <li>
              Refunds are described in our <Link href="/refunds" className="text-accent hover:underline">Refund &amp; Cancellation Policy</Link>.
            </li>
          </ul>

          <h2>5. Fair use</h2>
          <p>
            Do not try to break, overload or copy the service, share accounts, or use it to make spam or misleading content. We may limit
            or close accounts that do.
          </p>

          <h2>6. Availability and liability</h2>
          <p>
            We work to keep the service running well but cannot promise it is always available or error-free. To the extent the law
            allows, our liability for any claim is limited to the amount you paid us in the 3 months before it.
          </p>

          <h2>7. Changes</h2>
          <p>We may update these terms. If a change matters, we will tell you in the app or by email before it applies.</p>

          <h2>8. Law and contact</h2>
          <p>
            These terms are governed by the laws of India. Questions: {s.email}
            {s.phone ? `, ${s.phone}` : ""}. {s.name}, {s.address}.
          </p>
        </>
      )}
    </LegalPage>
  );
}
