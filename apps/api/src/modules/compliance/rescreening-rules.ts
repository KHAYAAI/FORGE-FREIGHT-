/**
 * Deciding who is overdue for a sanctions re-screen.
 *
 * A party is screened once, on the day it is created, and its
 * `screening_status` is then frozen forever. Sanctions lists are not frozen.
 * A counterparty cleared in March can be listed in August, and nothing in this
 * platform would notice — it would keep quoting, booking and invoicing them.
 *
 * This is the purest case for a scheduler in the whole system. No event of
 * ours will ever fire, because the change happens in someone else's database.
 * The only possible trigger is the passage of time.
 *
 * Pure, so the intervals can be tested without yente, a database or a clock.
 */

export type ScreeningStatus = "UNSCREENED" | "CLEAR" | "REVIEW" | "HIT";

/**
 * How long a verdict is trusted before it is asked again, in days.
 *
 * Not uniform, and the asymmetry is deliberate. `CLEAR` is the cheap, common
 * case and a month is proportionate. `REVIEW` and `HIT` are re-asked weekly
 * because those are the ones where the answer changing actually matters — a
 * delisting frees a customer to trade, and leaving them blocked for a month
 * after the list moved is a real cost to them and to us.
 */
export const RESCREEN_AFTER_DAYS: Record<ScreeningStatus, number> = {
  UNSCREENED: 0, // never asked — due immediately
  CLEAR: 30,
  REVIEW: 7,
  HIT: 7,
};

/**
 * Parties re-screened in a single run.
 *
 * Screening is a call to an external service per party, so a book of ten
 * thousand counterparties must not become ten thousand requests in one minute.
 * Oldest-first with a cap means the queue drains steadily and the provider is
 * never surprised; a backlog costs latency, not correctness.
 */
export const MAX_PER_RUN = 200;

export interface ScreenableParty {
  partyId: string;
  tenantId: string;
  name: string;
  country: string | null;
  status: ScreeningStatus;
  /** From the last `party.screened` event; null if never screened. */
  lastScreenedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether this party's verdict has gone stale. */
export function isDue(p: ScreenableParty, now: Date): boolean {
  if (!p.lastScreenedAt) return true;
  const ageDays = (now.getTime() - p.lastScreenedAt.getTime()) / DAY_MS;
  return ageDays >= RESCREEN_AFTER_DAYS[p.status];
}

/**
 * The batch to re-screen now: everything stale, oldest verdict first, capped.
 *
 * Oldest-first matters under a cap. Sorting any other way lets a party at the
 * back of a long queue go unscreened indefinitely while the front is asked
 * repeatedly — the cap would silently become a blind spot rather than a
 * throttle.
 */
export function selectForRescreening(
  parties: readonly ScreenableParty[],
  now: Date,
  limit: number = MAX_PER_RUN,
): ScreenableParty[] {
  return parties
    .filter((p) => isDue(p, now))
    .sort((a, b) => {
      // Never-screened first: an unknown counterparty is the worst case.
      if (!a.lastScreenedAt && !b.lastScreenedAt) return 0;
      if (!a.lastScreenedAt) return -1;
      if (!b.lastScreenedAt) return 1;
      return a.lastScreenedAt.getTime() - b.lastScreenedAt.getTime();
    })
    .slice(0, limit);
}
