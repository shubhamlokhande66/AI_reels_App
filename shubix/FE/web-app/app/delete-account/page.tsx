"use client";

import { LegalPage } from "@/components/molecules/Legal";

/** Delete account: its text is in Admin → CMS → Legal pages. */
export default function DeleteAccountPage() {
  return <LegalPage page="deletion" />;
}
