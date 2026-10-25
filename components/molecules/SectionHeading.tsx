import { cn } from "@/lib/cn";

/** A page section's heading: the title and one line under it, left or centred (Pricing: plans, credits, questions…). */
export function SectionHeading({ title, sub, center = false, id }: { title: string; sub?: string; center?: boolean; id?: string }) {
  return (
    <div id={id} className={cn("flex flex-col gap-1", center && "items-center text-center")}>
      <h2 className="m-0 font-[family-name:var(--font-display)] text-[19px] font-semibold tracking-[-0.015em] md:text-[22px]">{title}</h2>
      {sub && <p className="m-0 max-w-xl text-[14px] text-muted">{sub}</p>}
    </div>
  );
}
