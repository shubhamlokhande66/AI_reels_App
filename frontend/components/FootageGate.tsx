"use client";

import type { FootageCheck } from "@/lib/footage";
import { MIN_REEL_SECONDS } from "@/lib/footage";
import { btnPrimary, btnSecondary, Card } from "./ui";

/** Shown before a Reel is created when the clips are shorter than the Reel: add more footage, or shorten the Reel. */
export function FootageGate({
  check,
  onAddClips,
  onShorten,
  onClose,
  addLabel = "Add more clips",
  busy = false,
}: {
  check: FootageCheck;
  onAddClips: () => void;
  onShorten: (seconds: number) => void;
  onClose?: () => void;
  addLabel?: string;
  busy?: boolean;
}) {
  const missing = Math.ceil(check.needed - check.footage);
  const canShorten = check.footage >= MIN_REEL_SECONDS;
  return (
    <Card className="space-y-3 border-warning/50 bg-warning/10" >
      <div role="alert" className="space-y-1">
        <h3 className="font-semibold">Not enough footage for a {check.reel}s Reel</h3>
        <p className="text-sm">
          Your clips have about <strong>{Math.round(check.footage)}s</strong> of good footage. A {check.reel}s Reel needs about{" "}
          <strong>{Math.ceil(check.needed)}s</strong>, a little more than its length, so the editor can pick the best moments.
          Without about <strong>{missing}s</strong> more, it would have to slow shots down and show the same moments again.
        </p>
        <p className="text-sm text-muted">
          Add more clips (about {missing}s more){canShorten ? `, or make the Reel ${check.fits}s so every second is fresh footage` : ""}.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={onAddClips}>
          {addLabel}
        </button>
        {canShorten && (
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => onShorten(check.fits)}>
            Make it {check.fits}s
          </button>
        )}
        {onClose && (
          <button type="button" className="text-sm text-muted hover:underline" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </Card>
  );
}
