export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="lux-eyebrow">AI Reel Studio</p>
          <h1 className="mt-1 font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="lux-hairline mt-6" />
    </div>
  );
}
