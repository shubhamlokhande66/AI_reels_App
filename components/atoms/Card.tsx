export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`lux-card lux-enter rounded-3xl p-6 transition-colors ${className}`}>{children}</div>;
}
