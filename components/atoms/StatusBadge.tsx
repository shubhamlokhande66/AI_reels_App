import type { ProjectStatus } from "@/types/api";

const STATUS_STYLE: Record<ProjectStatus, string> = {
  draft: "border border-border bg-surface-2 text-muted",
  processing: "border border-accent/40 bg-accent/10 text-accent",
  completed: "border border-success/30 bg-success/10 text-success",
  failed: "border border-danger/40 bg-danger/10 text-danger",
};
const STATUS_LABEL: Record<ProjectStatus, string> = { draft: "Draft", processing: "Processing", completed: "Completed", failed: "Failed" };

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] ${STATUS_STYLE[status]}`}>
      {status === "processing" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[status]}
    </span>
  );
}
