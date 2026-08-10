import { describe, expect, it } from "vitest";
import {
  BACKOFF_HOURS,
  MAX_ATTEMPTS,
  nextAction,
  requestSourceRef,
  type UnconfirmedBooking,
} from "../src/modules/shipments/carrier-confirmation-rules.js";

const NOW = new Date("2026-06-01T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600_000);

const booking = (over: Partial<UnconfirmedBooking> = {}): UnconfirmedBooking => ({
  shipmentId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  bookingId: "33333333-3333-3333-3333-333333333333",
  reference: "FF-2026-00001",
  bookedAt: hoursAgo(1),
  attemptsMade: 0,
  lastAttemptAt: null,
  escalated: false,
  ...over,
});

describe("carrier confirmation ladder", () => {
  describe("before the first chase", () => {
    it("stays quiet on a booking made an hour ago", () => {
      expect(nextAction(booking(), NOW)).toBeNull();
    });

    it("chases once the first backoff window has passed", () => {
      const b = booking({ bookedAt: hoursAgo(BACKOFF_HOURS[0] + 1) });
      const action = nextAction(b, NOW);
      expect(action?.kind).toBe("REQUEST");
      if (action?.kind !== "REQUEST") return;
      expect(action.attempt).toBe(1);
      expect(action.unconfirmedHours).toBe(BACKOFF_HOURS[0] + 1);
    });

    it("measures the first wait from the booking, not from nothing", () => {
      const b = booking({ bookedAt: hoursAgo(BACKOFF_HOURS[0] - 1) });
      expect(nextAction(b, NOW)).toBeNull();
    });
  });

  describe("between chases the gaps widen", () => {
    it("waits longer before the second than before the first", () => {
      const tooSoon = booking({
        bookedAt: hoursAgo(48),
        attemptsMade: 1,
        lastAttemptAt: hoursAgo(BACKOFF_HOURS[1] - 1),
      });
      expect(nextAction(tooSoon, NOW)).toBeNull();

      const due = booking({
        bookedAt: hoursAgo(48),
        attemptsMade: 1,
        lastAttemptAt: hoursAgo(BACKOFF_HOURS[1] + 1),
      });
      const action = nextAction(due, NOW);
      expect(action?.kind).toBe("REQUEST");
      if (action?.kind === "REQUEST") expect(action.attempt).toBe(2);
    });

    it("measures later waits from the last chase, not the booking", () => {
      // Booked long ago, but chased a moment ago: still too soon.
      const b = booking({
        bookedAt: hoursAgo(500),
        attemptsMade: 1,
        lastAttemptAt: hoursAgo(1),
      });
      expect(nextAction(b, NOW)).toBeNull();
    });

    it("walks the whole ladder in order", () => {
      const attempts = BACKOFF_HOURS.map((_, i) => {
        const b = booking({
          bookedAt: hoursAgo(1000),
          attemptsMade: i,
          lastAttemptAt: hoursAgo(1000),
        });
        const a = nextAction(b, NOW);
        return a?.kind === "REQUEST" ? a.attempt : null;
      });
      expect(attempts).toEqual([1, 2, 3]);
    });
  });

  describe("when the ladder is exhausted a person is told", () => {
    it("escalates after the last attempt", () => {
      const b = booking({
        bookedAt: hoursAgo(72),
        attemptsMade: MAX_ATTEMPTS,
        lastAttemptAt: hoursAgo(2),
      });
      const action = nextAction(b, NOW);
      expect(action?.kind).toBe("ESCALATE");
      if (action?.kind !== "ESCALATE") return;
      expect(action.detail).toContain("Space may not be held");
    });

    it("escalates once, then stays quiet", () => {
      const b = booking({
        bookedAt: hoursAgo(72),
        attemptsMade: MAX_ATTEMPTS,
        lastAttemptAt: hoursAgo(2),
        escalated: true,
      });
      expect(nextAction(b, NOW)).toBeNull();
    });

    it("does not keep chasing past the maximum", () => {
      const b = booking({
        bookedAt: hoursAgo(500),
        attemptsMade: MAX_ATTEMPTS + 5,
        lastAttemptAt: hoursAgo(100),
        escalated: true,
      });
      expect(nextAction(b, NOW)).toBeNull();
    });
  });

  describe("idempotency — a booking is never duplicated by a retry", () => {
    it("derives the key from the attempt, never from the clock", () => {
      const a = requestSourceRef("ship-1", 2);
      const b = requestSourceRef("ship-1", 2);
      expect(a).toBe(b);
    });

    it("gives different attempts different keys", () => {
      expect(requestSourceRef("ship-1", 1)).not.toBe(
        requestSourceRef("ship-1", 2),
      );
    });

    it("gives different shipments different keys", () => {
      expect(requestSourceRef("ship-1", 1)).not.toBe(
        requestSourceRef("ship-2", 1),
      );
    });

    it("produces the same key when the same step runs twice", () => {
      // A workflow re-running the identical state must ask for the identical
      // thing, so the unique index rejects the second write rather than the
      // carrier receiving two requests.
      const b = booking({
        bookedAt: hoursAgo(1000),
        attemptsMade: 1,
        lastAttemptAt: hoursAgo(1000),
      });
      const first = nextAction(b, NOW);
      const second = nextAction(b, new Date(NOW.getTime() + 60_000));
      if (first?.kind !== "REQUEST" || second?.kind !== "REQUEST") {
        throw new Error("expected both to request");
      }
      expect(requestSourceRef(first.shipmentId, first.attempt)).toBe(
        requestSourceRef(second.shipmentId, second.attempt),
      );
    });
  });
});
