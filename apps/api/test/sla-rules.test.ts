import { describe, expect, it } from "vitest";
import {
  detectBreaches,
  SLA_DEFAULTS,
  type ShipmentSlaState,
} from "../src/modules/shipments/sla-rules.js";

const NOW = new Date("2026-06-01T00:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const shipment = (over: Partial<ShipmentSlaState> = {}): ShipmentSlaState => ({
  shipmentId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  reference: "FF-2026-00001",
  bookedAt: daysAgo(1),
  departedAt: null,
  arrivedAt: null,
  releasedAt: null,
  transitDays: 28,
  openCodes: [],
  ...over,
});

describe("SLA breach detection", () => {
  it("says nothing about a shipment booked yesterday", () => {
    expect(detectBreaches(shipment(), NOW)).toEqual([]);
  });

  describe("phase 1 — booked but never departed", () => {
    it("stays quiet inside the departure window", () => {
      const s = shipment({ bookedAt: daysAgo(SLA_DEFAULTS.departureDays - 1) });
      expect(detectBreaches(s, NOW)).toEqual([]);
    });

    it("raises congestion once the window is passed", () => {
      const s = shipment({ bookedAt: daysAgo(SLA_DEFAULTS.departureDays + 1) });
      const [b, ...rest] = detectBreaches(s, NOW);
      expect(rest).toHaveLength(0);
      expect(b?.code).toBe("CONGESTION_DELAY");
      expect(b?.detail).toContain("No departure");
    });

    it("says nothing once the vessel has sailed", () => {
      const s = shipment({
        bookedAt: daysAgo(60),
        departedAt: daysAgo(2),
      });
      expect(detectBreaches(s, NOW)).toEqual([]);
    });
  });

  describe("phase 2 — sailed but overdue", () => {
    it("allows planned transit plus the grace period", () => {
      const s = shipment({
        bookedAt: daysAgo(40),
        departedAt: daysAgo(28 + SLA_DEFAULTS.arrivalGraceDays - 1),
        transitDays: 28,
      });
      expect(detectBreaches(s, NOW)).toEqual([]);
    });

    it("raises congestion past transit plus grace", () => {
      const s = shipment({
        bookedAt: daysAgo(60),
        departedAt: daysAgo(28 + SLA_DEFAULTS.arrivalGraceDays + 1),
        transitDays: 28,
      });
      const [b] = detectBreaches(s, NOW);
      expect(b?.code).toBe("CONGESTION_DELAY");
      expect(b?.detail).toContain("Transit time exceeded");
    });

    it("falls back to a default transit when the lane carried none", () => {
      const inside = shipment({
        bookedAt: daysAgo(60),
        departedAt: daysAgo(SLA_DEFAULTS.fallbackTransitDays),
        transitDays: null,
      });
      expect(detectBreaches(inside, NOW)).toEqual([]);

      const outside = shipment({
        bookedAt: daysAgo(60),
        departedAt: daysAgo(
          SLA_DEFAULTS.fallbackTransitDays + SLA_DEFAULTS.arrivalGraceDays + 1,
        ),
        transitDays: null,
      });
      expect(detectBreaches(outside, NOW)).toHaveLength(1);
    });

    it("says nothing once the vessel has arrived", () => {
      const s = shipment({
        bookedAt: daysAgo(90),
        departedAt: daysAgo(60),
        arrivedAt: daysAgo(1),
        transitDays: 28,
      });
      expect(detectBreaches(s, NOW)).toEqual([]);
    });
  });

  describe("phase 3 — landed but not released", () => {
    it("allows the customs window", () => {
      const s = shipment({
        bookedAt: daysAgo(60),
        departedAt: daysAgo(40),
        arrivedAt: daysAgo(SLA_DEFAULTS.customsReleaseDays - 1),
      });
      expect(detectBreaches(s, NOW)).toEqual([]);
    });

    it("raises a customs query past it", () => {
      const s = shipment({
        bookedAt: daysAgo(60),
        departedAt: daysAgo(40),
        arrivedAt: daysAgo(SLA_DEFAULTS.customsReleaseDays + 1),
      });
      const [b] = detectBreaches(s, NOW);
      expect(b?.code).toBe("CUSTOMS_QUERY");
      expect(b?.detail).toContain("No customs release");
    });

    it("says nothing once customs has released it", () => {
      const s = shipment({
        bookedAt: daysAgo(60),
        departedAt: daysAgo(40),
        arrivedAt: daysAgo(30),
        releasedAt: daysAgo(1),
      });
      expect(detectBreaches(s, NOW)).toEqual([]);
    });
  });

  describe("idempotency — the reason this can run every hour", () => {
    it("does not repeat an exception that is already open", () => {
      const s = shipment({
        bookedAt: daysAgo(SLA_DEFAULTS.departureDays + 5),
        openCodes: ["CONGESTION_DELAY"],
      });
      expect(detectBreaches(s, NOW)).toEqual([]);
    });

    it("raises again once the open exception has been cleared", () => {
      const s = shipment({
        bookedAt: daysAgo(SLA_DEFAULTS.departureDays + 5),
        openCodes: [],
      });
      expect(detectBreaches(s, NOW)).toHaveLength(1);
    });

    it("keeps an unrelated open code from masking a different breach", () => {
      const s = shipment({
        bookedAt: daysAgo(60),
        departedAt: daysAgo(40),
        arrivedAt: daysAgo(SLA_DEFAULTS.customsReleaseDays + 1),
        openCodes: ["COMPLIANCE_HOLD"],
      });
      const [b] = detectBreaches(s, NOW);
      expect(b?.code).toBe("CUSTOMS_QUERY");
    });

    it("emits one card, not two, when both phases share a code in one pass", () => {
      // Never departed *and* — hypothetically — long past transit. Only the
      // first should produce a card; an operator needs one stuck-box card.
      const s = shipment({
        bookedAt: daysAgo(120),
        departedAt: null,
        transitDays: 1,
      });
      const out = detectBreaches(s, NOW);
      expect(out).toHaveLength(1);
      expect(out[0]?.code).toBe("CONGESTION_DELAY");
    });
  });

  describe("thresholds are configurable, not baked in", () => {
    it("honours an overridden departure window", () => {
      const s = shipment({ bookedAt: daysAgo(5) });
      expect(detectBreaches(s, NOW)).toEqual([]);
      expect(
        detectBreaches(s, NOW, { ...SLA_DEFAULTS, departureDays: 3 }),
      ).toHaveLength(1);
    });
  });
});
