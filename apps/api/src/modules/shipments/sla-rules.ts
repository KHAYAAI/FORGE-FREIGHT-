/**
 * SLA breach detection — the rules the ops kanban is fed from.
 *
 * These are the three checks the Temporal `shipmentLifecycle` workflow made by
 * holding a live process open per shipment for the length of its journey. They
 * are expressed here as a pure function over state that Postgres already holds,
 * because the workflow's in-memory `departed` / `arrived` / `released` flags
 * were a second copy of facts the event log had already recorded. Two copies of
 * one truth can disagree; a missed signal left the workflow reasoning about a
 * shipment that had already moved on.
 *
 * Being a pure function, this is testable without a database, a broker, a
 * workflow engine or Docker — which is the point. The scheduler only decides
 * *when* to ask; the answer lives here.
 */

/** Codes this sweep may raise. A subset of the exception_code enum. */
export type SlaExceptionCode = "CONGESTION_DELAY" | "CUSTOMS_QUERY";

export interface SlaThresholds {
  /** Days after booking before a missing departure is an exception. */
  departureDays: number;
  /** Slack added to planned transit before a missing arrival is an exception. */
  arrivalGraceDays: number;
  /** Used when the quote carried no transit time for the lane. */
  fallbackTransitDays: number;
  /** Days after arrival before a missing customs release is an exception. */
  customsReleaseDays: number;
}

export const SLA_DEFAULTS: SlaThresholds = {
  departureDays: 14,
  arrivalGraceDays: 7,
  fallbackTransitDays: 30,
  customsReleaseDays: 10,
};

/**
 * One shipment's position, assembled from the event log. A `null` timestamp
 * means the milestone has not been recorded — which is exactly what these
 * rules are looking for. The job is noticing what has *not* happened.
 */
export interface ShipmentSlaState {
  shipmentId: string;
  tenantId: string;
  reference: string;
  bookedAt: Date;
  departedAt: Date | null;
  arrivedAt: Date | null;
  releasedAt: Date | null;
  /** Planned transit from the quote; null when the rate card carried none. */
  transitDays: number | null;
  /** Codes already raised and not yet cleared, so the sweep does not repeat. */
  openCodes: readonly string[];
}

export interface SlaBreach {
  shipmentId: string;
  tenantId: string;
  reference: string;
  code: SlaExceptionCode;
  detail: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const daysSince = (from: Date, now: Date): number =>
  (now.getTime() - from.getTime()) / DAY_MS;

/**
 * Breaches this shipment has crossed and does not already have an open
 * exception for.
 *
 * Deliberately at most one open exception per code per shipment: an operator
 * looking at the kanban wants one card saying this box is stuck, not a new one
 * every hour the sweep runs. Clearing it lets the next real breach through.
 */
export function detectBreaches(
  s: ShipmentSlaState,
  now: Date,
  sla: SlaThresholds = SLA_DEFAULTS,
): SlaBreach[] {
  const breaches: SlaBreach[] = [];
  const open = new Set(s.openCodes);

  const raise = (code: SlaExceptionCode, detail: string) => {
    if (open.has(code)) return;
    breaches.push({
      shipmentId: s.shipmentId,
      tenantId: s.tenantId,
      reference: s.reference,
      code,
      detail,
    });
    // Guard within this pass too: phases 1 and 2 share a code, and the second
    // must not queue a duplicate of the row the first just created.
    open.add(code);
  };

  // Phase 1 — booked, but never left.
  if (!s.departedAt && daysSince(s.bookedAt, now) > sla.departureDays) {
    raise(
      "CONGESTION_DELAY",
      `No departure ${sla.departureDays} days after booking`,
    );
  }

  // Phase 2 — sailed, but overdue at the far end.
  if (s.departedAt && !s.arrivedAt) {
    const budget =
      (s.transitDays ?? sla.fallbackTransitDays) + sla.arrivalGraceDays;
    if (daysSince(s.departedAt, now) > budget) {
      raise(
        "CONGESTION_DELAY",
        `Transit time exceeded plan — not arrived ${Math.floor(
          daysSince(s.departedAt, now),
        )} days after departure`,
      );
    }
  }

  // Phase 3 — landed, but stuck in customs.
  if (s.arrivedAt && !s.releasedAt) {
    if (daysSince(s.arrivedAt, now) > sla.customsReleaseDays) {
      raise(
        "CUSTOMS_QUERY",
        `No customs release ${sla.customsReleaseDays} days after arrival`,
      );
    }
  }

  return breaches;
}
