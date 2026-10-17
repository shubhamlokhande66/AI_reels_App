export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  // the design's card (rounded 16, hairline border, soft shadow); its content keeps its own spacing
  return <div className={`card lux-enter block p-4 md:p-5 ${className}`}>{children}</div>;
}
