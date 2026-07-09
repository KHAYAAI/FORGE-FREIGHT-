import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-5">
      <div>
        {eyebrow && (
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-accent">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[22px] font-semibold tracking-tight text-primary">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-[12.5px] text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
