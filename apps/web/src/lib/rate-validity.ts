import type { RateCard } from "./types";

export type Validity = "expired" | "pending" | "live";

export interface DatedRateCard extends RateCard {
  validity: Validity;
}

/**
 * Where a rate card sits relative to now.
 *
 * Deliberately its own module rather than living beside the component that
 * renders it: that file is `"use client"`, and a server component cannot call
 * a function exported from one. The classification is resolved on the server
 * and passed down, so the clock is read once — a server and a browser
 * disagreeing about the time would otherwise flip the "expired" badge between
 * the HTML and the hydration.
 */
export function withValidity(cards: RateCard[], now = Date.now()): DatedRateCard[] {
  return cards.map((card) => ({
    ...card,
    validity:
      new Date(card.validTo).getTime() < now
        ? "expired"
        : new Date(card.validFrom).getTime() > now
          ? "pending"
          : "live",
  }));
}
