import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "critical";

const TONES: Record<Tone, string> = {
  neutral: "text-secondary bg-hover border-strong",
  accent: "text-accent-strong bg-accent-wash border-accent-border",
  info: "text-accent-strong bg-info-wash border-accent-border",
  success: "text-success bg-success-wash border-[color-mix(in_srgb,var(--success)_35%,transparent)]",
  warning: "text-warning bg-warning-wash border-[color-mix(in_srgb,var(--warning)_35%,transparent)]",
  critical: "text-critical bg-critical-wash border-[color-mix(in_srgb,var(--critical)_35%,transparent)]",
};

const DOT_COLOR: Record<Tone, string> = {
  neutral: "var(--text-tertiary)",
  accent: "var(--accent)",
  info: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  critical: "var(--critical)",
};

export function Tag({
  tone = "neutral",
  children,
  dot = false,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT_COLOR[tone] }} />
      )}
      {children}
    </span>
  );
}

const SHIPMENT_STATUS_TONE: Record<string, Tone> = {
  BOOKED: "neutral",
  IN_TRANSIT: "info",
  AT_DESTINATION_PORT: "accent",
  CUSTOMS: "warning",
  ON_DELIVERY: "info",
  DELIVERED: "success",
  CANCELLED: "critical",
};

export function ShipmentStatusTag({ status }: { status: string }) {
  return (
    <Tag tone={SHIPMENT_STATUS_TONE[status] ?? "neutral"} dot>
      {status.replaceAll("_", " ")}
    </Tag>
  );
}

const ENTRY_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  PREPARED: "info",
  SUBMITTED: "accent",
  QUERY: "warning",
  RELEASED: "success",
  STOPPED: "critical",
};

export function CustomsStatusTag({ status }: { status: string }) {
  return (
    <Tag tone={ENTRY_STATUS_TONE[status] ?? "neutral"} dot>
      {status}
    </Tag>
  );
}

const INVOICE_STATUS_TONE: Record<string, Tone> = {
  ISSUED: "info",
  PART_PAID: "warning",
  PAID: "success",
  OVERDUE: "critical",
  CANCELLED: "neutral",
};

export function InvoiceStatusTag({ status }: { status: string }) {
  return (
    <Tag tone={INVOICE_STATUS_TONE[status] ?? "neutral"} dot>
      {status.replaceAll("_", " ")}
    </Tag>
  );
}

const DOC_REVIEW_TONE: Record<string, Tone> = {
  PENDING_EXTRACTION: "neutral",
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "critical",
};

export function DocReviewTag({ status }: { status: string }) {
  return (
    <Tag tone={DOC_REVIEW_TONE[status] ?? "neutral"} dot>
      {status.replaceAll("_", " ")}
    </Tag>
  );
}

const EXCEPTION_SEVERITY: Record<string, Tone> = {
  COMPLIANCE_HOLD: "critical",
  CUSTOMS_STOPPED: "critical",
  BOOKING_ROLLED: "critical",
  CUSTOMS_QUERY: "warning",
  DEPARTURE_SLA_BREACH: "warning",
  CUSTOMS_RELEASE_SLA_BREACH: "warning",
  TRANSIT_OVERRUN: "info",
  CONGESTION_DELAY: "info",
};

export function exceptionSeverity(code: string): Tone {
  return EXCEPTION_SEVERITY[code] ?? "neutral";
}
