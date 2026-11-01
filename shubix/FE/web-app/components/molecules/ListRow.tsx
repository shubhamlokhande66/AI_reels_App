import { cn } from "@/lib/cn";

/** One item in a list of cards (a brand, a voice, a user…): its picture, its name and a line under it, then its
 * buttons on the right. */
export function ListRow({ lead, title, meta, actions, className }: { lead?: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-[14px] border border-border bg-surface p-2.5 shadow-[var(--shadow)]", className)}>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <b className="truncate text-[14px]">{title}</b>
        {meta}
      </span>
      {actions}
    </div>
  );
}
