"use client";

import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/hooks/useApi";
import { Badge, Button, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, PageHeader } from "@/components/molecules";
import { AffiliateView, dayOf } from "@/components/organisms/AffiliateView";

/** The affiliate's dashboard: their link and terms (set by the administrator for them), link clicks, the customers they
 * brought (usernames only), every sale with its commission, and the payouts. Every word: Admin → CMS → Affiliate dashboard. */
export default function AffiliatePage() {
  const t = useT();
  const q = useQuery({ queryKey: ["my-affiliate"], queryFn: api.myAffiliate, retry: false });
  if (q.isLoading) return <Spinner label={t("aff.loading")} />;
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const a = q.data?.affiliate;
  if (!a) return <div className="mx-auto mt-6 max-w-md"><EmptyState icon="coins" title={t("aff.notYet")} action={<Button href="/rewards">{t("aff.toRewards")}</Button>} /></div>;
  if (a.status !== "active")
    return (
      <div className="mx-auto mt-6 max-w-md">
        <EmptyState icon="coins" title={t(a.status === "pending" ? "aff.pendingTitle" : "aff.pausedTitle")} hint={t(a.status === "pending" ? "rewards.affPending" : "rewards.affPaused")}
          action={<Button href="/rewards" variant="secondary">{t("aff.toRewards")}</Button>} />
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader title={t("nav.affiliate")} subtitle={t("aff.sub")} />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Badge tone="success">@{a.username}</Badge>
        {a.since && <span>· {dayOf(a.since)}</span>}
      </div>
      <AffiliateView a={a} />
    </div>
  );
}
