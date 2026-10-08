"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { checkFootage, type FootageCheck } from "@/lib/footage";
import { PICKER_VIDEO, isVideoFile } from "@/lib/format";
import type { Project } from "@/types/api";
import { Dropzone } from "./Dropzone";
import { FootageGate } from "./FootageGate";
import { ProgressBar } from "./ProgressStages";
import { Card, ErrorBanner } from "./ui";

/** The clips of a project that count as footage (not deleted for privacy, not skipped as unusable). */
export function projectFootage(project: Project): (number | null)[] {
  return project.videos.filter((v) => !v.purged && v.analysis?.usable !== false).map((v) => v.analysis?.goodSeconds ?? v.duration);
}

export function checkProject(project: Project, seconds?: number): FootageCheck {
  return checkFootage(projectFootage(project), seconds ?? project.settings.duration);
}

/** The gate on the project page: shown before a Reel is created when the clips are shorter than the Reel. "Add more
 * clips" uploads straight into this project and then continues; "Make it N s" continues at the shorter length. */
export function ProjectFootageGate({
  project,
  check,
  onContinue,
  onClose,
}: {
  project: Project;
  check: FootageCheck;
  onContinue: (seconds: number | null) => void; // null = the length stays (more clips were added)
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: File[]) {
    setError(null);
    setPct(0);
    try {
      const res = await api.uploadVideos(project.id, files, setPct);
      if (res.failed.length) setError(res.failed.map((f) => `${f.name}: ${f.error.message}`).join("; "));
      const fresh = await qc.fetchQuery({ queryKey: keys.project(project.id), queryFn: () => api.getProject(project.id) });
      const again = checkProject(fresh as Project, check.reel);
      setPct(null);
      if (again.ok) onContinue(null);
      else setError(`Now about ${Math.round(again.footage)}s of good footage; about ${Math.ceil(again.needed - again.footage)}s more is needed. Add more, or shorten the Reel.`);
    } catch (e) {
      setPct(null);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="my-4 space-y-3">
      <FootageGate check={check} onAddClips={() => setAdding(true)} onShorten={(s) => onContinue(s)} onClose={onClose} busy={pct !== null} />
      {adding && (
        <Card className="space-y-2">
          <Dropzone
            label="Drop more clips for this Reel here"
            hint="They are added to this project; the Reel starts once there is enough footage"
            accept={PICKER_VIDEO}
            multiple
            disabled={pct !== null}
            validate={isVideoFile}
            onReject={(n) => setError(`Unsupported video file: ${n.join(", ")}`)}
            onFiles={upload}
          />
          {pct !== null && <ProgressBar value={pct * 100} label="Upload progress" showEta />}
        </Card>
      )}
      {error && <ErrorBanner message={error} />}
    </div>
  );
}
