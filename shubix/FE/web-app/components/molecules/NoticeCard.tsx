import { cn } from "@/lib/cn";
import { Card } from "@/components/atoms/Card";
import { Heading } from "@/components/atoms/Heading";
import { Icon } from "@/components/atoms/Icon";

/** A centred notice (not enough credits, admin only…): a round icon, a small label, the title, a line, then the
 * buttons. `dialog`: it is a pop-up (screen readers say so). */
export function NoticeCard({ icon, eyebrow, title, text, actions, dialog = false, className, onClick }: { icon: string; eyebrow?: string; title: string; text?: React.ReactNode; actions?: React.ReactNode; dialog?: boolean; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <Card role={dialog ? "dialog" : undefined} aria-modal={dialog || undefined} aria-label={title} onClick={onClick} className={cn("flex w-full max-w-sm flex-col items-center gap-2.5 px-5 py-[26px] text-center md:px-5 md:py-[26px]", className)}>
      <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-accent/12 text-accent">
        <Icon name={icon} size={34} stroke={1.5} />
      </span>
      {eyebrow && <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">{eyebrow}</span>}
      <Heading className="text-[19px] md:text-[20px]">{title}</Heading>
      {text && <span className="text-[12.5px] text-muted">{text}</span>}
      {actions && <div className="mt-1.5 flex w-full flex-col gap-2">{actions}</div>}
    </Card>
  );
}
