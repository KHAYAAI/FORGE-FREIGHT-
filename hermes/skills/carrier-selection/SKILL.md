---
name: carrier-selection
description: Use when choosing between carriers for a lane. Ranks the valid options on cost, transit and — once scorecards exist — reliability, and explains each. Recommends only; never books.
---

# Carrier selection

Produce a ranked, explained recommendation. A human decides.

## What the platform does today, and why it is not enough

`selectRateCard` picks **the cheapest valid card for the lane**, with a
deterministic tiebreak. That is all. It cannot know a carrier missed its
transit nine times on that corridor last quarter, because nothing computes
that yet.

So today this skill can rank on price, validity and quoted transit — and it
should say plainly that reliability is missing from its ranking rather than
implying a completeness it does not have.

## Steps

1. `get_shipment` — lane, mode, equipment, incoterm, and the service level the
   consignment asked for.
2. `get_rate_cards` — filter to cards **valid at the date the cargo moves**,
   not merely valid today. A card expiring mid-voyage is a card that will not
   honour the price.
3. For each candidate, reconstruct the landed cost with its surcharges (see
   `pricing-analysis` for the bases — getting these wrong changes the ranking).
4. Check quoted transit against the service level. The engine refuses express
   against a sailing that cannot make it; a recommendation should not propose
   what the engine would reject.
5. Rank, and explain each line in one sentence.

## When scorecards exist

`get_carrier_performance` is not yet available — it needs `carrier_scorecards`
from the learning slice. **Do not invent a reliability figure in the
meantime.** When it lands, the intended shape is:

```
reliability = 0.8 × on_time_rate + 0.2 × (1 − claim_rate)
rank_score  = landed_cost × (1.05 − reliability)
```

So a carrier 10% more expensive wins if it is meaningfully more reliable, and
price still dominates when reliability is close.

Two rules that come with it:

- **Below the confidence threshold, ignore it.** A carrier is not "unreliable"
  on two shipments. If the scorecard's sample is thin, rank on price and say
  the history is too short to judge.
- **Leave room for exploration.** A carrier starved of volume stops accruing
  evidence and can never recover its score. A ranking that only ever picks
  today's winner makes its own history.

## Output

```
RANK  CARRIER        LANDED COST   TRANSIT  RELIABILITY  WHY
1     Maersk Line    USD 6,441     28d      —            cheapest valid card; no history yet
2     CMA CGM        USD 6,890     24d      —            4 days faster for USD 449
```

State the reliability column as `—` while scorecards are unavailable. An empty
column is honest; a fabricated number is not.

## Boundaries

**Never book. Never accept a quote. Never change a rate card.** Those tools do
not exist in the MCP surface, and this skill must not ask for them.
