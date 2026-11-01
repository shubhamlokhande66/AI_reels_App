import { cn } from "@/lib/cn";
import { Card } from "@/components/atoms/Card";
import { Heading } from "@/components/atoms/Heading";
import { Icon } from "@/components/atoms/Icon";

/** A titled card: an icon, the title and a line, something on the right (a link, a count), then its content. */
export function SectionCard({ icon, title, sub, aside, className, children }: { icon?: string; title: string; sub?: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <Card as="section" aria-label={title} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex items-center gap-3">
        {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name={icon} size={17} /></span>}
        <div className="min-w-0 flex-1">
          <Heading size="section" as="h2" className="truncate">{title}</Heading>
          {sub && <p className="m-0 truncate text-[12px] text-muted">{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}
