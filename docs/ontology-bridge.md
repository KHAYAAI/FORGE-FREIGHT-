# Freight events → Revenue Ontology mapping

This is the boundary artifact between FORGE Freight (operations) and the
ForgePay Revenue Ontology (financial state). Its executable form is
`@forge-freight/ontology-bridge`. **The event catalogue was designed with this
destination in mind** — events flagged `financial: true` in
`@forge-freight/events` are exactly the events that cross this bridge.

## Design rules

1. Only financially-meaningful freight events produce ledger events; the
   bridge is a pure function `freightEvent → LedgerEvent[]`.
2. One freight event may fan out to several ledger events.
3. Every ledger event carries `sourceEventId` for a full audit trail back to
   the operational fact.
4. The bridge never enriches from projections — everything the ledger needs
   must be in the event payload. (This constrains payload design upstream:
   e.g. `entry.released` carries duty/VAT totals.)
5. Replays are safe: the ledger dedupes on `(sourceEventId, type)`.

## The mapping

| Freight event | Ledger event(s) | Meaning |
| --- | --- | --- |
| `shipment.booked` | `credit.signal` (SHIPMENT_OPENED) | Exposure begins; feeds counterparty credit history. |
| `vessel.departed` | `credit.signal` (MILESTONE_ON_TIME) | Milestone performance → credit signal. Freight charge accrual arrives separately via `charge.accrued` (billing owns amounts, tracking does not). |
| `charge.accrued` | `obligation.created` | Customer obligation exists before invoicing — real-time WIP exposure. |
| `entry.released` | `disbursement.incurred` + `finance.trigger` (DUTY_FINANCING_ELIGIBLE) | We paid SARS duties/VAT on the customer's behalf; the duty-financing product can settle/advance against it immediately. |
| `pod.confirmed` | `finance.trigger` (FACTORING_CLOCK_START) | Delivery proven → the invoice-factoring clock starts. |
| `invoice.issued` | `receivable.recognised` | Formal receivable; factoring advances price off this plus the POD trigger. |
| `payment.received` | `receivable.settled` | Cash in, reconciled via ForgePay. |

## Trade-finance views (derived, not stored)

- **Duty-financing eligibility**: open `disbursement.incurred` amounts with a
  `DUTY_FINANCING_ELIGIBLE` trigger and no matching settlement.
- **Factoring status**: receivables where `FACTORING_CLOCK_START` has fired,
  aged against `receivable.settled`.
- **Credit score input**: counterparty history of `credit.signal` events —
  on-time milestone ratio, shipment volume, settlement latency.

## Versioning

The ledger event schema is versioned with the freight catalogue. A breaking
change on either side requires both versions to coexist in the bridge until
all consumers migrate — same rule as the event catalogue itself.
