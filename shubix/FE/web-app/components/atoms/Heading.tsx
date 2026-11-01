import { cn } from "@/lib/cn";

/** The app's headings, one calm scale everywhere (a luxury feel: semibold, small steps, slightly tight letters):
 * `page` a page's big title, `title` a card's or dialog's title, `section` a small bold heading inside a card. */
export type HeadingSize = "page" | "title" | "section";
const SIZE: Record<HeadingSize, string> = {
  page: "font-[family-name:var(--font-display)] text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] md:text-[28px]",
  title: "font-[family-name:var(--font-display)] text-[17px] font-semibold leading-[1.25] tracking-[-0.01em] md:text-[18px]",
  section: "text-[15px] font-semibold tracking-[-0.005em]",
};

export function Heading({ size = "title", as: Tag = size === "page" ? "h1" : "h2", className, children, ...rest }: { size?: HeadingSize; as?: "h1" | "h2" | "h3" | "span"; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLHeadingElement>) {
  return <Tag className={cn("m-0", SIZE[size], className)} {...rest}>{children}</Tag>;
}
