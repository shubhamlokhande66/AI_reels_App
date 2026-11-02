"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import type { SiteInfo } from "@/types/api";
import { Button, Card, Heading, Icon, Input, Spinner, TextArea } from "@/components/atoms";
import { Field } from "@/components/molecules";
import { useSite } from "@/components/molecules/Legal";
import { cn } from "@/lib/cn";

/** Admin → Settings → Business details: the name, support email, phone / WhatsApp, address, the legal pages' date and the
 * phone apps' store links (the Google Play and App Store badges).
 * The Contact, Privacy, Terms and Refunds pages show them (and Razorpay asks for a real email and address); a detail not
 * filled in is left out for people, never a placeholder. Saved here, no restart; an empty field follows the server's
 * environment. */
const FIELDS: { key: keyof SiteInfo; label: string; hint: string; placeholder: string; needed?: boolean; long?: boolean }[] = [
  { key: "businessName", label: "Business name", hint: "On the legal pages and the Contact page", placeholder: "Shubix" },
  { key: "supportEmail", label: "Support email", hint: "Where people write to you; needed by Razorpay", placeholder: "support@yourdomain.com", needed: true },
  { key: "supportPhone", label: "Phone / WhatsApp (optional)", hint: "Shown on the Contact page with a WhatsApp link", placeholder: "+91 98765 43210" },
  { key: "legalUpdated", label: "Legal pages last updated", hint: "Shown under the Terms, Privacy and Refunds titles", placeholder: "25 October 2026" },
  { key: "businessAddress", label: "Registered address", hint: "On the legal pages; needed by Razorpay", placeholder: "Street, city, state, PIN", needed: true, long: true },
  { key: "gstin", label: "GSTIN (optional)", hint: "Printed on every payment receipt; leave empty if not registered", placeholder: "27ABCDE1234F1Z5" },
  { key: "playStoreUrl", label: "Google Play link (Android app)", hint: "The “Get it on Google Play” badge; empty shows “Coming soon”", placeholder: "https://play.google.com/store/apps/details?id=…" },
  { key: "appStoreUrl", label: "App Store link (iPhone app)", hint: "The “Download on the App Store” badge; empty shows “Coming soon”", placeholder: "https://apps.apple.com/app/…" },
];

export function BusinessSettings({ bare = false }: { bare?: boolean }) {
  const qc = useQueryClient();
  const site = useSite();
  const [draft, setDraft] = useState<Partial<SiteInfo>>({});
  const [saved, setSaved] = useState(false);
  const save = useMutation({ meta: { success: "Saved", errorShown: true }, mutationFn: () => api.setSite(draft), onSuccess: (s) => { qc.setQueryData(["site"], s); setDraft({}); setSaved(true); } });
  if (!site.data) return site.isLoading ? <Spinner size="sm" label="Loading business details…" /> : null;
  const value = (k: keyof SiteInfo) => draft[k] ?? site.data![k] ?? "";
  const missing = FIELDS.filter((f) => f.needed && !value(f.key).trim());
  const dirty = Object.keys(draft).length > 0;
  return (
    <Card as="section" aria-label="Business details" className={cn("flex flex-col gap-3", bare && "border-0 bg-transparent p-0 shadow-none md:p-0")}>
      <div className={cn("flex flex-wrap items-start gap-3", bare && "hidden")}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="bag" size={19} /></span>
        <div className="min-w-0 flex-1">
          <Heading size="section" as="h2">Business details</Heading>
          <p className="m-0 text-[12.5px] text-muted">Shown on the Contact, Privacy, Terms and Refunds pages. A detail left empty is left out for people.</p>
        </div>
      </div>
      {missing.length > 0 && (
        <p className="m-0 flex items-center gap-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-[12.5px] font-semibold text-warning">
          <Icon name="warn" size={16} />Still to fill in: {missing.map((f) => f.label.toLowerCase()).join(" and ")}.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f.key} label={<span>{f.label}{f.needed && <span className="text-danger"> *</span>}</span>} hint={f.hint} className={f.long ? "sm:col-span-2" : undefined}>
            {f.long
              ? <TextArea rows={2} value={value(f.key)} placeholder={f.placeholder} onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, [f.key]: e.target.value })); }} />
              : <Input type={f.key === "supportEmail" ? "email" : f.key.endsWith("Url") ? "url" : "text"} value={value(f.key)} placeholder={f.placeholder} onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, [f.key]: e.target.value })); }} />}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {save.error ? <span className="mr-auto text-[13px] text-danger">{errorMessage(save.error)}</span> : saved && <span className="mr-auto text-[13px] font-semibold text-success">✓ Saved: the pages show them now</span>}
        {dirty && <Button variant="secondary" onClick={() => setDraft({})}>Cancel</Button>}
        <Button icon="check" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save details</Button>
      </div>
    </Card>
  );
}
