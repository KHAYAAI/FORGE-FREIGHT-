import type { ReactNode } from "react";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded border border-dashed border-strong px-6 py-12 text-center">
      <div className="text-[13px] font-medium text-secondary">{title}</div>
      {description && <div className="mt-1 max-w-sm text-[12px] text-tertiary">{description}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-4 py-3 text-[12.5px] text-critical">
      API unavailable — {message}
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border-l-2 border-accent bg-accent-wash px-4 py-3 text-[12.5px] text-secondary">
      {children}
    </div>
  );
}
