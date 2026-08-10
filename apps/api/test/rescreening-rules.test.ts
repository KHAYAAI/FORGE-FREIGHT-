import { describe, expect, it } from "vitest";
import {
  isDue,
  MAX_PER_RUN,
  RESCREEN_AFTER_DAYS,
  selectForRescreening,
  type ScreenableParty,
} from "../src/modules/compliance/rescreening-rules.js";

const NOW = new Date("2026-06-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const party = (over: Partial<ScreenableParty> = {}): ScreenableParty => ({
  partyId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  name: "Ubuntu Trading (Pty) Ltd",
  country: "ZA",
  status: "CLEAR",
  lastScreenedAt: daysAgo(1),
  ...over,
});

describe("sanctions re-screening", () => {
  describe("who is due", () => {
    it("treats a party that has never been screened as due immediately", () => {
      expect(isDue(party({ status: "UNSCREENED", lastScreenedAt: null }), NOW)).toBe(true);
    });

    it("leaves a recently cleared party alone", () => {
      expect(isDue(party({ lastScreenedAt: daysAgo(1) }), NOW)).toBe(false);
    });

    it("re-asks a cleared party after the interval", () => {
      const stale = party({ lastScreenedAt: daysAgo(RESCREEN_AFTER_DAYS.CLEAR + 1) });
      expect(isDue(stale, NOW)).toBe(true);
    });

    it("re-asks REVIEW and HIT sooner than CLEAR", () => {
      const age = daysAgo(RESCREEN_AFTER_DAYS.REVIEW + 1);
      expect(isDue(party({ status: "REVIEW", lastScreenedAt: age }), NOW)).toBe(true);
      expect(isDue(party({ status: "HIT", lastScreenedAt: age }), NOW)).toBe(true);
      // Same age, a CLEAR verdict is still trusted.
      expect(isDue(party({ status: "CLEAR", lastScreenedAt: age }), NOW)).toBe(false);
    });

    it("is due exactly on the boundary, not a day later", () => {
      const exactly = party({ lastScreenedAt: daysAgo(RESCREEN_AFTER_DAYS.CLEAR) });
      expect(isDue(exactly, NOW)).toBe(true);
    });
  });

  describe("choosing the batch", () => {
    it("returns nothing when every verdict is fresh", () => {
      const fresh = [party(), party({ partyId: "b" })];
      expect(selectForRescreening(fresh, NOW)).toEqual([]);
    });

    it("puts never-screened parties at the front", () => {
      const batch = selectForRescreening(
        [
          party({ partyId: "old", lastScreenedAt: daysAgo(400) }),
          party({ partyId: "never", status: "UNSCREENED", lastScreenedAt: null }),
        ],
        NOW,
      );
      expect(batch.map((p) => p.partyId)).toEqual(["never", "old"]);
    });

    it("orders the rest oldest verdict first", () => {
      const batch = selectForRescreening(
        [
          party({ partyId: "recent", lastScreenedAt: daysAgo(31) }),
          party({ partyId: "ancient", lastScreenedAt: daysAgo(900) }),
          party({ partyId: "middling", lastScreenedAt: daysAgo(120) }),
        ],
        NOW,
      );
      expect(batch.map((p) => p.partyId)).toEqual(["ancient", "middling", "recent"]);
    });

    it("caps the batch so one run cannot flood the provider", () => {
      const many = Array.from({ length: MAX_PER_RUN + 50 }, (_, i) =>
        party({ partyId: `p${i}`, lastScreenedAt: daysAgo(100 + i) }),
      );
      expect(selectForRescreening(many, NOW)).toHaveLength(MAX_PER_RUN);
    });

    it("drains the backlog steadily rather than starving the tail", () => {
      // Oldest-first under a cap means yesterday's leftovers are the front of
      // today's queue. Sorting any other way would leave the tail unscreened
      // forever while the head is asked again and again.
      const many = Array.from({ length: 5 }, (_, i) =>
        party({ partyId: `p${i}`, lastScreenedAt: daysAgo(100 + i) }),
      );
      const firstRun = selectForRescreening(many, NOW, 2);
      expect(firstRun.map((p) => p.partyId)).toEqual(["p4", "p3"]);

      // p4 and p3 screened; the next run picks up where it left off.
      const after = many.map((p) =>
        firstRun.some((f) => f.partyId === p.partyId)
          ? { ...p, lastScreenedAt: NOW }
          : p,
      );
      const secondRun = selectForRescreening(after, NOW, 2);
      expect(secondRun.map((p) => p.partyId)).toEqual(["p2", "p1"]);
    });

    it("honours a smaller limit when one is given", () => {
      const many = Array.from({ length: 10 }, (_, i) =>
        party({ partyId: `p${i}`, lastScreenedAt: daysAgo(100) }),
      );
      expect(selectForRescreening(many, NOW, 3)).toHaveLength(3);
    });
  });
});
