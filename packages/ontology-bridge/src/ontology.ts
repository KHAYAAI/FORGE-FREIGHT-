import { z } from "zod";
import { Money } from "@forge-freight/events";

/**
 * Revenue Ontology canonical ledger events — the shape ForgePay's ledger
 * consumes. Kept deliberately small: the ontology cares about obligations,
 * receivables, disbursements, and the risk signals derived from operational
 * performance. Freight-specific detail stays on the freight side; only the
 * financial meaning crosses this boundary.
 */

export const LedgerEventType = z.enum([
  /** A revenue obligation came into existence (customer owes us, eventually). */
  "obligation.created",
  /** A receivable was formalised (invoice issued, factoring clock may start). */
  "receivable.recognised",
  /** We paid money out on the customer's behalf (duties, VAT — financeable). */
  "disbursement.incurred",
  /** Cash arrived against a receivable. */
  "receivable.settled",
  /** A trade-finance product trigger fired (duty financing, factoring). */
  "finance.trigger",
  /** An operational performance fact usable as credit signal. */
  "credit.signal",
]);
export type LedgerEventType = z.infer<typeof LedgerEventType>;

export const FinanceTrigger = z.enum([
  /** entry.released → duty amount is now financeable / settlement starts. */
  "DUTY_FINANCING_ELIGIBLE",
  /** pod.confirmed → delivery proven, invoice factoring clock starts. */
  "FACTORING_CLOCK_START",
]);
export type FinanceTrigger = z.infer<typeof FinanceTrigger>;

export const CreditSignal = z.enum([
  /** Shipment lifecycle opened — exposure begins. */
  "SHIPMENT_OPENED",
  /** Milestone reported on time vs plan — positive history. */
  "MILESTONE_ON_TIME",
]);
export type CreditSignal = z.infer<typeof CreditSignal>;

export const LedgerEvent = z.object({
  ledgerEventId: z.string().uuid(),
  type: LedgerEventType,
  /** The freight event this was derived from — full audit trail. */
  sourceEventId: z.string().uuid(),
  sourceEventType: z.string(),
  tenantId: z.string().uuid(),
  shipmentId: z.string().uuid().nullable(),
  counterpartyId: z.string().uuid().nullable(),
  amount: Money.nullable(),
  trigger: FinanceTrigger.nullable(),
  signal: CreditSignal.nullable(),
  occurredAt: z.string().datetime({ offset: true }),
  metadata: z.record(z.unknown()),
});
export type LedgerEvent = z.infer<typeof LedgerEvent>;
