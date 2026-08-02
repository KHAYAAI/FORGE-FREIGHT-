import {
  CARGO_TYPE_UPLIFT_BPS,
  URGENCY_PROFILE,
  type CargoType,
  type Urgency,
} from "../consignments/packing.js";

/**
 * The quote engine — pure domain logic, no framework or database imports.
 * The Nest module wires a Drizzle-backed RateSource in; tests use an
 * in-memory one. All money is integer cents.
 */

export interface RateCardInput {
  id: string;
  kind: "CONTRACT" | "SPOT";
  carrierName: string;
  mode: "OCEAN" | "AIR" | "ROAD" | "RAIL";
  origin: string;
  destination: string;
  containerType: string | null;
  buyAmountCents: number;
  currency: string;
  transitDays: number | null;
  validFrom: Date;
  validTo: Date;
  surcharges: SurchargeInput[];
}

export interface SurchargeInput {
  code: string;
  description: string;
  basis: "PER_CONTAINER" | "PER_SHIPMENT" | "PER_BL" | "PERCENT_OF_FREIGHT";
  /** Cents, except PERCENT_OF_FREIGHT where it is basis points of freight buy. */
  amountCents: number;
  currency: string;
}

export interface MarginRuleInput {
  id: string;
  customerId: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  marginBps: number;
  minMarginCents: number;
  /** Tiebreak between rules of equal specificity — see `resolveMarginRule`. */
  createdAt: Date;
}

export interface QuoteRequest {
  customerId: string;
  origin: string;
  destination: string;
  mode: "OCEAN" | "AIR" | "ROAD" | "RAIL";
  containerType: string | null;
  quantity: number;
  requestedAt: Date;
  /**
   * What is in the box and how fast it must move. Optional so quotes raised
   * before consignment capture keep working; when present, both change the
   * price and the second also narrows which carriers are eligible at all.
   */
  cargoType?: CargoType;
  urgency?: Urgency;
  /** Rolled up from the packing list — the basis a per-kg tariff applies to. */
  chargeableWeightGrams?: number;
}

export interface QuoteLine {
  chargeCode: string;
  description: string;
  quantity: number;
  buyCents: number;
  sellCents: number;
  currency: string;
}

export interface QuoteResult {
  rateCardId: string;
  carrierName: string;
  transitDays: number | null;
  lines: QuoteLine[];
  /** Sell totals per currency — quotes on SA lanes are legitimately multicurrency. */
  totalsByCurrency: Record<string, number>;
  marginRuleId: string;
  /** Echoed back so a quote records the basis it was priced on. */
  chargeableWeightGrams: number | null;
}

export class NoRateError extends Error {
  constructor(req: QuoteRequest) {
    super(
      `No valid rate for ${req.origin}→${req.destination} ${req.mode} ${req.containerType ?? ""} at ${req.requestedAt.toISOString()}`,
    );
    this.name = "NoRateError";
  }
}

/**
 * The lane is priced, but nothing on it is fast enough for the service level
 * asked for. Deliberately its own error: "we do not serve that corridor" and
 * "we serve it in 34 days and you asked for 10" are different conversations
 * with the customer, and answering the second with the first loses the sale
 * for the wrong reason.
 */
export class NoServiceLevelError extends Error {
  constructor(req: QuoteRequest, best: number | null) {
    const cap = URGENCY_PROFILE[req.urgency ?? "STANDARD"].maxTransitDays;
    super(
      `No ${req.urgency} service on ${req.origin}→${req.destination}: ` +
        `the fastest available transit is ${best ?? "unknown"} days against a ${cap}-day requirement`,
    );
    this.name = "NoServiceLevelError";
  }
}

export class NoMarginRuleError extends Error {
  constructor() {
    super("No margin rule matches this request and no default rule exists");
    this.name = "NoMarginRuleError";
  }
}

/**
 * Most-specific-wins margin rule resolution. A rule with a non-null field
 * must match the request exactly; specificity is customer (8) > lane (4) >
 * mode (2). The all-null rule is the tenant default.
 *
 * Ties are broken by recency, newest first. Two rules of equal scope is a
 * configuration mistake rather than a design, but it is an easy one to make
 * — and until this tiebreak existed the winner was whichever row Postgres
 * happened to return first, so the same quote could be priced differently on
 * two runs with nothing changed. Newest-wins at least matches what an
 * operator means when they add a rule on top of an old one.
 */
export function resolveMarginRule(
  rules: MarginRuleInput[],
  req: QuoteRequest,
): MarginRuleInput {
  let best: { rule: MarginRuleInput; score: number } | null = null;
  for (const rule of rules) {
    if (rule.customerId !== null && rule.customerId !== req.customerId) continue;
    const laneSpecified = rule.origin !== null || rule.destination !== null;
    if (rule.origin !== null && rule.origin !== req.origin) continue;
    if (rule.destination !== null && rule.destination !== req.destination) continue;
    if (rule.mode !== null && rule.mode !== req.mode) continue;
    const score =
      (rule.customerId !== null ? 8 : 0) +
      (laneSpecified ? 4 : 0) +
      (rule.mode !== null ? 2 : 0);
    const wins =
      !best ||
      score > best.score ||
      (score === best.score && rule.createdAt > best.rule.createdAt);
    if (wins) best = { rule, score };
  }
  if (!best) throw new NoMarginRuleError();
  return best.rule;
}

/**
 * Percentage margin on every line; the absolute floor applies only to the
 * freight line — flooring each small surcharge would inflate them absurdly
 * (a USD 210 BAF must not carry a ZAR 1,500-equivalent markup).
 */
function applyMargin(
  buyCents: number,
  rule: MarginRuleInput,
  withFloor: boolean,
): number {
  const withMargin = Math.round(buyCents * (1 + rule.marginBps / 10_000));
  return withFloor ? Math.max(withMargin, buyCents + rule.minMarginCents) : withMargin;
}

/** Rate cards that serve the lane at this instant, cheapest first. */
export function eligibleRateCards(
  cards: RateCardInput[],
  req: QuoteRequest,
): RateCardInput[] {
  return cards
    .filter(
      (c) =>
        c.origin === req.origin &&
        c.destination === req.destination &&
        c.mode === req.mode &&
        (c.containerType === null || c.containerType === req.containerType) &&
        c.validFrom <= req.requestedAt &&
        c.validTo >= req.requestedAt,
    )
    .sort(
      (a, b) => a.buyAmountCents - b.buyAmountCents || a.id.localeCompare(b.id),
    );
}

/**
 * Pick the cheapest valid rate card for the lane (deterministic tiebreak by
 * id), subject to the service level asked for.
 *
 * A rate card with no stated transit is not excluded by an urgent request —
 * an unknown transit is unknown, not slow, and refusing to quote it would
 * silently drop carriers for a data gap rather than a service one.
 */
export function selectRateCard(
  cards: RateCardInput[],
  req: QuoteRequest,
): RateCardInput | null {
  const valid = eligibleRateCards(cards, req);
  const cap = URGENCY_PROFILE[req.urgency ?? "STANDARD"].maxTransitDays;
  if (cap === null) return valid[0] ?? null;
  const inTime = valid.filter((c) => c.transitDays === null || c.transitDays <= cap);
  return inTime[0] ?? null;
}

export function buildQuote(
  req: QuoteRequest,
  cards: RateCardInput[],
  rules: MarginRuleInput[],
): QuoteResult {
  if (!Number.isInteger(req.quantity) || req.quantity < 1) {
    throw new RangeError(`quantity must be a positive integer, got ${req.quantity}`);
  }
  const card = selectRateCard(cards, req);
  if (!card) {
    // Distinguish "no rate on this lane" from "no rate fast enough". The
    // second is a service conversation, not a coverage one.
    const anyOnLane = eligibleRateCards(cards, req);
    if (anyOnLane.length > 0) {
      const fastest = anyOnLane
        .map((c) => c.transitDays)
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b)[0];
      throw new NoServiceLevelError(req, fastest ?? null);
    }
    throw new NoRateError(req);
  }
  const rule = resolveMarginRule(rules, req);

  const lines: QuoteLine[] = [];

  const freightBuy = card.buyAmountCents;
  lines.push({
    chargeCode: "FRT",
    description: `${card.mode} freight ${req.origin}→${req.destination} (${card.carrierName})`,
    quantity: req.quantity,
    buyCents: freightBuy,
    sellCents: applyMargin(freightBuy, rule, true),
    currency: card.currency,
  });

  // Handling and service uplifts are computed off the freight buy and carried
  // as their own lines rather than folded into the freight rate. A customer
  // who asks why hazardous cargo costs more deserves a line that says so, and
  // an operator renegotiating a carrier rate needs the base untouched.
  const cargoUplift = CARGO_TYPE_UPLIFT_BPS[req.cargoType ?? "GENERAL"];
  if (cargoUplift > 0) {
    const buy = Math.round((freightBuy * cargoUplift) / 10_000);
    lines.push({
      chargeCode: "HND",
      description: `${(req.cargoType ?? "GENERAL").replace(/_/g, " ").toLowerCase()} cargo handling`,
      quantity: req.quantity,
      buyCents: buy,
      sellCents: applyMargin(buy, rule, false),
      currency: card.currency,
    });
  }

  const serviceUplift = URGENCY_PROFILE[req.urgency ?? "STANDARD"].upliftBps;
  if (serviceUplift > 0) {
    const buy = Math.round((freightBuy * serviceUplift) / 10_000);
    lines.push({
      chargeCode: "SVC",
      description: `${(req.urgency ?? "STANDARD").toLowerCase()} service level`,
      quantity: req.quantity,
      buyCents: buy,
      sellCents: applyMargin(buy, rule, false),
      currency: card.currency,
    });
  }

  for (const s of card.surcharges) {
    const perUnitBuy =
      s.basis === "PERCENT_OF_FREIGHT"
        ? Math.round((freightBuy * s.amountCents) / 10_000)
        : s.amountCents;
    const quantity = s.basis === "PER_CONTAINER" ? req.quantity : 1;
    lines.push({
      chargeCode: s.code,
      description: s.description,
      quantity,
      buyCents: perUnitBuy,
      sellCents: applyMargin(perUnitBuy, rule, false),
      currency: s.basis === "PERCENT_OF_FREIGHT" ? card.currency : s.currency,
    });
  }

  const totalsByCurrency: Record<string, number> = {};
  for (const line of lines) {
    totalsByCurrency[line.currency] =
      (totalsByCurrency[line.currency] ?? 0) + line.sellCents * line.quantity;
  }

  return {
    rateCardId: card.id,
    carrierName: card.carrierName,
    transitDays: card.transitDays,
    lines,
    totalsByCurrency,
    marginRuleId: rule.id,
    chargeableWeightGrams: req.chargeableWeightGrams ?? null,
  };
}
