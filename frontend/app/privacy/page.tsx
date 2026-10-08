"use client";

import { LegalPage } from "@/components/Legal";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      {(s) => (
        <>
          <p>
            This policy explains what {s.name} collects, why, and the choices you have. We collect as little as we can and keep it only as
            long as needed.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li><strong>Account:</strong> your email address and a securely hashed password (we never see or store the password itself).</li>
            <li><strong>Your content:</strong> the clips, music, photos and stories you upload, and the Reels made from them.</li>
            <li><strong>Usage:</strong> your projects, credits and their history, and payment records (amount, date, plan).</li>
            <li>
              <strong>Payments:</strong> handled by Razorpay. Your card, UPI or bank details go to Razorpay, not to us; we only receive a
              payment confirmation.
            </li>
          </ul>

          <h2>Why we use it</h2>
          <ul>
            <li>To make your Reels, keep your account and credits, take payments and answer your questions.</li>
            <li>To keep the service secure and working. We do not sell your data and do not use it for advertising.</li>
          </ul>

          <h2>Services that help us</h2>
          <ul>
            <li>AI services (for example Google Gemini) receive the text or keyframes needed for a feature you use, such as planning a story or making a narration.</li>
            <li>Cloud services host the app and its database, and may make AI pictures for story scenes.</li>
            <li>Razorpay processes payments. Social networks receive a Reel only when you ask us to post it.</li>
          </ul>

          <h2>How long we keep it</h2>
          <ul>
            <li>Uploaded clips and finished projects are deleted automatically after the period shown in the app.</li>
            <li>When you delete your account, your content, projects and credits are deleted. Payment records are kept as tax law requires, without the link to you.</li>
          </ul>

          <h2>Cookies</h2>
          <p>We use one essential cookie to keep you signed in. We do not use advertising or tracking cookies.</p>

          <h2>Your rights</h2>
          <p>
            You can see and download your Reels, correct your details, and delete your account and all its data at any time from the
            Account page. Under India&apos;s Digital Personal Data Protection Act you may also ask us about your data or raise a
            concern: write to {s.email}.
          </p>

          <h2>Security</h2>
          <p>Connections are encrypted (HTTPS), passwords are hashed, and each account can only reach its own data.</p>

          <h2>Contact</h2>
          <p>
            {s.name}, {s.address}. Email: {s.email}
            {s.phone ? `. Phone: ${s.phone}` : ""}.
          </p>
        </>
      )}
    </LegalPage>
  );
}
