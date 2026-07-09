/**
 * SA customs duty & import VAT arithmetic. Integer cents throughout;
 * half-up rounding at each statutory step, mirroring SARS practice.
 *
 * Import VAT base is the Added Tax Value:
 *   ATV = customs value + 10% upliftment (non-SACU imports) + duties
 *   VAT = 15% of ATV
 */

export const VAT_RATE_BPS = 1500;
export const ATV_UPLIFT_BPS = 1000;

export interface DutyLineInput {
  customsValueCents: number;
  /** Ad valorem duty rate in basis points (e.g. 2000 = 20%). */
  dutyRateBps: number;
  /** SACU-origin goods skip the 10% ATV upliftment. */
  sacuOrigin?: boolean;
}

export interface DutyLineResult {
  customsValueCents: number;
  dutyCents: number;
  atvCents: number;
  vatCents: number;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function computeDutyLine(input: DutyLineInput): DutyLineResult {
  if (!Number.isInteger(input.customsValueCents) || input.customsValueCents < 0) {
    throw new RangeError("customsValueCents must be a non-negative integer");
  }
  if (input.dutyRateBps < 0) throw new RangeError("dutyRateBps must be >= 0");

  const dutyCents = roundHalfUp((input.customsValueCents * input.dutyRateBps) / 10_000);
  const upliftCents = input.sacuOrigin
    ? 0
    : roundHalfUp((input.customsValueCents * ATV_UPLIFT_BPS) / 10_000);
  const atvCents = input.customsValueCents + upliftCents + dutyCents;
  const vatCents = roundHalfUp((atvCents * VAT_RATE_BPS) / 10_000);

  return { customsValueCents: input.customsValueCents, dutyCents, atvCents, vatCents };
}

export function computeEntryTotals(lines: DutyLineResult[]) {
  return {
    dutiesTotalCents: lines.reduce((s, l) => s + l.dutyCents, 0),
    vatTotalCents: lines.reduce((s, l) => s + l.vatCents, 0),
  };
}

// ---------------------------------------------------------------------------
// Entry state machine
// ---------------------------------------------------------------------------

export type EntryStatus =
  | "DRAFT"
  | "PREPARED"
  | "SUBMITTED"
  | "QUERY"
  | "RELEASED"
  | "STOPPED";

const TRANSITIONS: Record<EntryStatus, EntryStatus[]> = {
  DRAFT: ["PREPARED"],
  PREPARED: ["SUBMITTED", "DRAFT"],
  SUBMITTED: ["QUERY", "RELEASED", "STOPPED"],
  QUERY: ["SUBMITTED", "STOPPED"],
  RELEASED: [],
  STOPPED: ["SUBMITTED"], // stop lifted → resubmission
};

export class InvalidEntryTransitionError extends Error {
  constructor(from: EntryStatus, to: EntryStatus) {
    super(`Customs entry cannot move ${from} → ${to}`);
    this.name = "InvalidEntryTransitionError";
  }
}

export function assertTransition(from: EntryStatus, to: EntryStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidEntryTransitionError(from, to);
  }
}
