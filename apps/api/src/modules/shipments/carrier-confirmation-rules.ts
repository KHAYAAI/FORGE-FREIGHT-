/**
 * Chasing carriers for booking confirmations we have already promised.
 *
 * A shipment can exist internally with no carrier booking reference: the
 * operator books, the customer is told their cargo is moving, and the carrier
 * has not yet confirmed that space is actually held. Nothing watches that gap
 * today, and it is an expensive one — the first sign of trouble is a container
 * with nowhere to go.
 *
 * This is the retry ladder from the brief, with one difference in placement:
 * it hangs off the shipment existing, not off quote acceptance. `QuoteAccepted`
 * and `ShipmentBooked` are emitted inside one transaction in
 * `bookings.service.ts`, so there is no interval between them for a scheduler
 * to occupy. The confirmation conversation happens *after* the booking is
 * durable, which is also the only order in which retrying is safe: the
 * internal booking is already committed, so a retry can never create a second
 * one.
 *
 * Pure, so the ladder can be tested without a carrier, a database or a broker.
 */

/** Widening gaps between chases, in hours. One entry per attempt. */
export const BACKOFF_HOURS = [6, 12, 24] as const;

/** Attempts before the machine gives up and a person is told. */
export const MAX_ATTEMPTS = BACKOFF_HOURS.length;

export interface UnconfirmedBooking {
  shipmentId: string;
  tenantId: string;
  bookingId: string;
  reference: string;
  /** When the shipment was opened internally. */
  bookedAt: Date;
  /** Chases already sent — the count of confirmation_requested events. */
  attemptsMade: number;
  /** When the last chase went out; null if none has. */
  lastAttemptAt: Date | null;
  /** True once a human has already been told this one is not confirming. */
  escalated: boolean;
}

export type ConfirmationAction =
  | {
      kind: "REQUEST";
      shipmentId: string;
      tenantId: string;
      bookingId: string;
      reference: string;
      attempt: number;
      unconfirmedHours: number;
    }
  | {
      kind: "ESCALATE";
      shipmentId: string;
      tenantId: string;
      bookingId: string;
      reference: string;
      detail: string;
    };

const HOUR_MS = 60 * 60 * 1000;
const hoursSince = (from: Date, now: Date) =>
  Math.floor((now.getTime() - from.getTime()) / HOUR_MS);

/**
 * What to do about one unconfirmed booking, right now.
 *
 * Returns nothing when it is simply too early — which is most of the time, and
 * is what stops an hourly schedule turning into an hourly email to a carrier.
 */
export function nextAction(
  b: UnconfirmedBooking,
  now: Date,
): ConfirmationAction | null {
  const unconfirmedHours = hoursSince(b.bookedAt, now);

  if (b.attemptsMade >= MAX_ATTEMPTS) {
    // The ladder is exhausted. Tell a person once, then stay quiet: an ops
    // board that repeats itself is an ops board nobody reads.
    if (b.escalated) return null;
    return {
      kind: "ESCALATE",
      shipmentId: b.shipmentId,
      tenantId: b.tenantId,
      bookingId: b.bookingId,
      reference: b.reference,
      detail:
        `No carrier confirmation after ${MAX_ATTEMPTS} attempts over ` +
        `${unconfirmedHours}h. Space may not be held — confirm by phone.`,
    };
  }

  // Backoff: the wait before attempt N is BACKOFF_HOURS[N-1], measured from
  // the booking for the first chase and from the last chase thereafter.
  const waitHours = BACKOFF_HOURS[b.attemptsMade]!;
  const since = b.lastAttemptAt ?? b.bookedAt;
  if (hoursSince(since, now) < waitHours) return null;

  return {
    kind: "REQUEST",
    shipmentId: b.shipmentId,
    tenantId: b.tenantId,
    bookingId: b.bookingId,
    reference: b.reference,
    attempt: b.attemptsMade + 1,
    unconfirmedHours,
  };
}

/**
 * The idempotency key for a chase.
 *
 * The brief's requirement — "a booking must never be duplicated because a
 * workflow was retried" — is met here rather than in the workflow. The key is
 * derived from the shipment and the attempt number, never from the clock, so
 * a workflow that runs the same step twice produces the same key and the
 * `(type, source_ref)` unique index rejects the second write. Kestra is free
 * to be unreliable.
 */
export function requestSourceRef(shipmentId: string, attempt: number): string {
  return `carrier-confirm:${shipmentId}:${attempt}`;
}
