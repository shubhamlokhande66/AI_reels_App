import type { ProjectStatus } from "@/types/api";

const STATUS_CLASS: Record<ProjectStatus, string> = { draft: "", processing: "b-run", completed: "b-ok", failed: "b-bad" };
const STATUS_LABEL: Record<ProjectStatus, string> = { draft: "Draft", processing: "Processing", completed: "Completed", failed: "Failed" };

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`badge ${STATUS_CLASS[status]}`}>
      {status === "processing" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[status]}
    </span>
  );
}
