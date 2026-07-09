export function BarRow({ label, value, max, tone = "accent" }: { label: string; value: number; max: number; tone?: "accent" | "warning" | "success" | "critical" }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0;
  const color = {
    accent: "var(--accent)",
    warning: "var(--warning)",
    success: "var(--success)",
    critical: "var(--critical)",
  }[tone];

  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0 truncate text-[11.5px] text-secondary">{label}</div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-hover">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="tabular w-8 shrink-0 text-right text-[11.5px] text-primary">{value}</div>
    </div>
  );
}
