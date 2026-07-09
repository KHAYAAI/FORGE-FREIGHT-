import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded border border-hairline bg-surface",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <div>
        {eyebrow && (
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-tertiary">
            {eyebrow}
          </div>
        )}
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-primary">
          {title}
        </h2>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
