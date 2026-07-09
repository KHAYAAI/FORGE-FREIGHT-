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
}

export interface QuoteRequest {
  customerId: string;
  origin: string;
  destination: string;
  mode: "OCEAN" | "AIR" | "ROAD" | "RAIL";
  containerType: string | null;
  quantity: number;
  requestedAt: Date;
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
}

export class NoRateError extends Error {
  constructor(req: QuoteRequest) {
    super(
      `No valid rate for ${req.origin}→${req.destination} ${req.mode} ${req.containerType ?? ""} at ${req.requestedAt.toISOString()}`,
    );
    this.name = "NoRateError";
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
    if (!best || score > best.score) best = { rule, score };
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

/** Pick the cheapest valid rate card for the lane (deterministic tiebreak by id). */
export function selectRateCard(
  cards: RateCardInput[],
  req: QuoteRequest,
): RateCardInput | null {
  const valid = cards
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
  return valid[0] ?? null;
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
  if (!card) throw new NoRateError(req);
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
  };
}
