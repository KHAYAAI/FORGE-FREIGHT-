---
name: pricing-analysis
description: Use when someone asks why a quote is priced as it is, or whether a margin is thin. Reconstructs the quote from the rate card and margin rule that produced it, using read-only tools. Explains; never reprices.
---

# Pricing analysis

Explain a price that already exists. The quote engine is the authority on what
a lane costs — this skill reconstructs its reasoning so a human can check it,
and never proposes a number of its own.

## The model, exactly

Get this right or say nothing. A plausible-looking formula that is not the one
the platform uses will produce confident explanations that do not match the
invoice, which is worse than declining to explain.

**1. Chargeable weight comes first.** Volume against mass, whichever bills
higher, using the mode's volumetric divisor. The packing list decides the
price before any rate is applied — a quote raised without one is priced on
assumptions.

**2. The buy side is a rate card.** `get_rate_cards` for the lane. The engine
takes the **cheapest card valid at the moment of quoting** — validity is a
window, and an expired card is not a cheap card, it is not a card. Each card
carries surcharges, and each surcharge has a **basis** that decides how it
scales:

| Basis | Multiplied by |
|---|---|
| `PER_CONTAINER` | container count |
| `PER_SHIPMENT` | once |
| `PER_BL` | once per bill of lading |
| `PERCENT_OF_FREIGHT` | the freight line, in basis points |

Applying a per-container surcharge once, or a percentage to the whole invoice
rather than to freight, is the commonest way an explanation goes wrong.

**3. The sell side is a margin rule.** `get_margin_rules`. The engine picks the
**most specific** rule that matches — specificity is how many of
`customerId`, `origin`, `destination`, `mode` are set — and breaks ties by
**recency**. Margin is in basis points (1800 = 18%).

**4. The floor applies to freight only, and is converted first.**
`minMarginCents` is held in ZAR cents. Comparing it to a USD line as though it
were dollars turns an 18% margin into something absurd. It applies to the
freight line alone: flooring every small surcharge would inflate them past
sense.

## Steps

1. `get_quote` — the lines as issued, with buy, sell and currency.
2. `get_rate_cards` and `get_margin_rules` — the inputs that were available.
3. Rebuild each line and compare to what was stored.
4. Report the decomposition in plain language, per line.

## What to flag

- A line whose margin sits at the floor rather than the percentage — the lane
  is barely worth running at this rate.
- A quote priced from a card that has since expired, or expires before the
  cargo moves.
- A percentage surcharge whose base looks wrong.
- Any line you cannot reconstruct. **Say so.** An unexplained line is a finding,
  not a rounding difference.

## Boundaries

Read-only. This skill does not reprice, does not adjust margin, and does not
propose a rate. Repricing is a commercial decision with a person's name on it.
