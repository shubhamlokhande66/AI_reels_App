import { cn } from "@/lib/cn";

/** A picture's frame (a Reel's cover, a draft, a template): rounded, a dark placeholder until the picture is there;
 * an <img> or <video> inside fills it. */
export function Photo({ className, children, ...rest }: { className?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-[#2a2350] [&>img]:absolute [&>img]:inset-0 [&>img]:h-full [&>img]:w-full [&>img]:object-cover [&>video]:absolute [&>video]:inset-0 [&>video]:h-full [&>video]:w-full [&>video]:object-cover", className)} {...rest}>
      {children}
    </div>
  );
}

/** The small label in a picture's corner ("0:15"). */
export function DurationTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("absolute bottom-1.5 left-1.5 z-[1] rounded-md bg-[rgba(10,9,8,.72)] px-1.5 py-0.5 text-[10px] font-bold text-white", className)}>{children}</span>;
}
