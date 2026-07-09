/**
 * Pure booking-domain rules, kept out of the service so they are trivially
 * testable and reusable by the Temporal workflow later.
 */

export interface BookableQuote {
  id: string;
  tenantId: string;
  status: "DRAFT" | "ISSUED" | "ACCEPTED" | "EXPIRED" | "DECLINED";
  validUntil: Date;
}

export class QuoteNotBookableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "QuoteNotBookableError";
  }
}

/** A quote can be booked while ISSUED (or already ACCEPTED) and unexpired. */
export function assertBookable(quote: BookableQuote, now: Date): void {
  if (quote.status === "DECLINED" || quote.status === "EXPIRED") {
    throw new QuoteNotBookableError(`Quote is ${quote.status}`);
  }
  if (quote.status === "DRAFT") {
    throw new QuoteNotBookableError("Quote has not been issued");
  }
  if (quote.validUntil < now) {
    throw new QuoteNotBookableError(
      `Quote expired ${quote.validUntil.toISOString().slice(0, 10)} — re-quote before booking`,
    );
  }
}

export interface LegPlan {
  sequence: number;
  mode: "OCEAN" | "AIR" | "ROAD" | "RAIL";
  origin: string;
  destination: string;
}

/**
 * Derive the leg plan from the quoted lane. Single leg in the quoted mode;
 * multi-leg routing (e.g. ZADUR discharge + ZAJNB road delivery) is composed
 * by ops on the shipment after booking, or by future routing logic.
 */
export function planLegs(quote: {
  origin: string;
  destination: string;
  mode: "OCEAN" | "AIR" | "ROAD" | "RAIL";
}): LegPlan[] {
  return [
    {
      sequence: 1,
      mode: quote.mode,
      origin: quote.origin,
      destination: quote.destination,
    },
  ];
}
