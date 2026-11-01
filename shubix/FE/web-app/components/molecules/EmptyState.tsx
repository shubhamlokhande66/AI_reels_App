import { Card } from "@/components/atoms/Card";
import { Heading } from "@/components/atoms/Heading";
import { Icon } from "@/components/atoms/Icon";

/** The design's empty card: a round icon, a serif line, a hint and the next step. */
export function EmptyState({ title, hint, action, icon = "sparkle" }: { title: string; hint?: string; action?: React.ReactNode; icon?: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-4 py-[22px] text-center md:px-4 md:py-[22px]">
      <span className="grid h-[54px] w-[54px] place-items-center rounded-full border-[1.5px] border-border text-accent">
        <Icon name={icon} size={24} />
      </span>
      <Heading as="span">{title}</Heading>
      {hint && <span className="max-w-sm text-[12.5px] text-muted">{hint}</span>}
      {action && <div className="mt-1">{action}</div>}
    </Card>
  );
}
