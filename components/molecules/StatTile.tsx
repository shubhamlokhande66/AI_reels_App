import { cn } from "@/lib/cn";
import { Icon } from "@/components/atoms/Icon";

/** A number on a tile (the admin's overview): the figure in big type, what it counts under it; with `icon` the label
 * goes on top and the icon sits on the right; `note` is a line under it all. */
export function StatTile({ value, label, icon, note, lead, className }: { value: React.ReactNode; label: string; icon?: string; note?: string; lead?: React.ReactNode; className?: string }) {
  const figure = <b className="font-[family-name:var(--font-display)] text-[22px] font-semibold leading-none tracking-[-0.01em] tabular-nums">{value}</b>;
  return (
    <div className={cn("grid min-w-0 gap-x-2 gap-y-0.5 rounded-2xl border border-border bg-surface p-3 shadow-[var(--shadow)]", icon ? "grid-cols-[1fr_auto]" : "grid-cols-1", className)}>
      {icon ? (
        <>
          <span className="text-[11px] font-bold text-muted">{label}</span>
          <span className="col-start-2 row-span-2 grid h-9 w-9 place-items-center rounded-full border border-border bg-[var(--chip-on)] text-accent"><Icon name={icon} size={18} /></span>
          <span className="flex items-center gap-2">{lead}{figure}</span>
        </>
      ) : (
        <>
          {figure}
          <span className="text-[11px] text-muted">{label}</span>
        </>
      )}
      {note && <span className="col-span-2 text-[11px] text-muted">{note}</span>}
    </div>
  );
}
