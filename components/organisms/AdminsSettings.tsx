"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { emailOk } from "@/lib/validate";
import { Badge, Button, Card, Heading, Icon, Input, Spinner } from "@/components/atoms";
import { ErrorBanner, Field } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { cn } from "@/lib/cn";

/** Admin → Settings → Administrators: who runs the studio. The owners come from the server (ADMIN_EMAILS) and stay;
 * more can be added here by email (they sign in with that email's account). Every administrator has the admin pages
 * and everything of the studio open: every plan's pages, Shubix AI, and no credits taken. */
export function AdminsSettings({ bare = false }: { bare?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admins"], queryFn: api.admins });
  const [email, setEmail] = useState("");
  const done = (d: Awaited<ReturnType<typeof api.admins>>) => { qc.setQueryData(["admins"], d); setEmail(""); };
  const add = useMutation({ mutationFn: api.addAdmin, onSuccess: done });
  const remove = useMutation({ mutationFn: api.removeAdmin, onSuccess: (d) => qc.setQueryData(["admins"], d) });
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner size="sm" label="Loading administrators…" />;
  const drop = async (e: string) => {
    if (await confirmAction({ title: `Remove ${e} as administrator?`, body: "They keep their account, but lose the admin pages and the open access.", ok: "Remove", danger: true })) remove.mutate(e);
  };
  return (
    <Card as="section" aria-label="Administrators" className={cn("flex flex-col gap-3", bare && "border-0 bg-transparent p-0 shadow-none md:p-0")}>
      <div className={bare ? "hidden" : undefined}>
        <Heading size="section" as="h2">Administrators</Heading>
      </div>
      <p className="m-0 text-[12.5px] text-muted">Administrators open these admin pages and have everything in the studio open: every plan&apos;s pages, Shubix AI, and no credits are taken. They also get the admin emails (new affiliate requests, Contact messages).</p>
      <div className="flex flex-col gap-2">
        {q.data.admins.map((a) => (
          <div key={a.email} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5">
            <Icon name="shield" size={16} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{a.email}</span>
            {a.owner ? <Badge tone="brand">Owner · server</Badge>
              : <Button size="sm" variant="ghost" loading={remove.isPending && remove.variables === a.email} onClick={() => void drop(a.email)}>Remove</Button>}
          </div>
        ))}
        {!q.data.admins.length && <p className="m-0 text-[12.5px] text-muted">No administrator email yet{q.data.keySet ? " (this browser is unlocked with the admin key)" : ""}.</p>}
      </div>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (emailOk(email)) add.mutate(email.trim()); }}>
        <Field label="Add an administrator (their account's email)" className="flex-1">
          <Input type="email" value={email} placeholder="name@email.com" onChange={(e) => { setEmail(e.target.value); add.reset(); }} />
        </Field>
        <Button type="submit" icon="plus" disabled={!emailOk(email)} loading={add.isPending}>Add</Button>
      </form>
      {(add.error || remove.error) && <ErrorBanner message={errorMessage(add.error ?? remove.error)} />}
      <p className="m-0 text-[12px] text-muted">The owners are set on the server (ADMIN_EMAILS, several separated by commas) and can only be changed there.</p>
    </Card>
  );
}
