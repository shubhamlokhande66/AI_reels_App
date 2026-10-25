import type { ProjectStatus } from "@/types/api";
import { Badge, type BadgeTone } from "./Badge";

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = { draft: "neutral", processing: "brand", completed: "success", failed: "danger" };
const STATUS_LABEL: Record<ProjectStatus, string> = { draft: "Draft", processing: "Processing", completed: "Completed", failed: "Failed" };

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      {status === "processing" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
}
