import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Pulsing placeholder block — the primitive every route's loading.tsx
 * composes into a skeleton matching that screen's real layout.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("animate-pulse rounded bg-hover", className)} style={style} aria-hidden="true" />;
}

export function SkeletonText({ className, width = "100%" }: { className?: string; width?: string }) {
  return <Skeleton className={cn("h-3", className)} style={{ width }} />;
}

/** Matches PageHeader's layout: eyebrow + title + description, hairline border-bottom. */
export function SkeletonPageHeader() {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
    </div>
  );
}

/** Matches StatTile's layout: label + big value + sub line. */
export function SkeletonStatTile() {
  return (
    <div className="rounded border border-hairline bg-surface p-4">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="mt-2.5 h-7 w-16" />
      <Skeleton className="mt-2.5 h-3 w-24" />
    </div>
  );
}

/** Matches Table's layout: header row + N body rows across `cols` columns. */
export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[12.5px]">
        <thead className="border-b border-hairline">
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="px-5 py-2.5">
                <Skeleton className="h-2.5 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-hairline last:border-0">
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="px-5 py-3">
                  <Skeleton className="h-3" style={{ width: c === 0 ? "70%" : "50%" }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Matches Panel's layout: hairline border, PanelHeader, then arbitrary children. */
export function SkeletonPanel({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded border border-hairline bg-surface p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <Skeleton className="h-3 w-32" />
      </div>
      {children}
    </section>
  );
}
