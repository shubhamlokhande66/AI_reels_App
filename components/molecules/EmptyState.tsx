import { Icon } from "@/components/atoms/Icon";

/** The design's empty card: a round icon, a serif line, a hint and the next step. */
export function EmptyState({ title, hint, action, icon = "sparkle" }: { title: string; hint?: string; action?: React.ReactNode; icon?: string }) {
  return (
    <div className="card lux-enter items-center px-4 py-[22px] text-center" style={{ gap: 8 }}>
      <span className="grid h-[54px] w-[54px] place-items-center rounded-full border-[1.5px] border-border text-accent">
        <Icon name={icon} size={24} />
      </span>
      <b className="ht" style={{ fontSize: 20 }}>
        {title}
      </b>
      {hint && <span className="mu sm max-w-sm">{hint}</span>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
