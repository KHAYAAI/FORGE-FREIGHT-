import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "critical";
}) {
  const valueColor = {
    neutral: "text-primary",
    accent: "text-accent-strong",
    success: "text-success",
    warning: "text-warning",
    critical: "text-critical",
  }[tone];

  return (
    <div className="rounded border border-hairline bg-surface p-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-tertiary">
        {label}
      </div>
      <div className={cn("tabular mt-2 text-[26px] font-semibold leading-none tracking-tight", valueColor)}>
        {value}
      </div>
      {sub && <div className="mt-2 text-[11.5px] text-secondary">{sub}</div>}
    </div>
  );
}
