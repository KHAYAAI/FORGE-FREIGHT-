---
name: post-shipment-analysis
description: Use after a shipment closes, to compare what we expected against what happened and propose a lesson. Blocked until the outcome tables exist — read the note below before using.
---

# Post-shipment analysis

The learning loop: **outcome → evaluation → proposal → a human approves →
policy**. This is the skill that makes the platform improve rather than merely
execute.

## It cannot run yet, and pretending otherwise is the failure mode

This skill depends on three things that do not exist:

- `ShipmentClosed` — nothing marks a shipment commercially finished, so there
  is no trigger. `PodConfirmed` is delivery, not closure.
- `shipment_outcomes` — expected against actual is not reconciled anywhere.
- `get_shipment_outcome` and `create_lesson` — no such tools.

**If asked to run this today, say what is missing and stop.** The data to do it
by hand exists in the event log, so it is tempting to reconstruct an outcome
per shipment and call that learning. Do not. A lesson derived once, informally,
by a process nobody can repeat, is an opinion with a citation — and it will be
quoted later as though it were measured.

`docs/target-architecture.md` has the slices that unblock this.

## What it will do

1. Read the closed shipment's outcome: planned against actual carrier, route,
   transit, cost, margin; exceptions raised; documents rejected.
2. Decide whether the deviation is material. Transit overrun beyond the grace
   period, a margin miss against the rule that priced it, a customs query that
   cost days.
3. Investigate the cause across shipments, not within one. **One late vessel is
   weather; the same carrier late nine times on one corridor is a fact.**
4. Draft a proposal — never a policy. Something like:

   > Deprioritise Carrier A on CNSHA→ZADUR in Q4. 9 of 14 sailings overran by
   > 4+ days; Carrier B overran 1 of 11 at 3% higher cost.

5. Attach the evidence and the backtest. **A proposal that cannot be backtested
   against history cannot be approved**, so one that cannot be tested should not
   be raised.
6. Hand it to a human. It becomes policy when someone approves it, and not
   before.

## The three traps

- **Correlation for cause.** Season, port congestion and carrier confound each
  other constantly. State the evidence; let a person conclude.
- **Too little data.** Below the confidence threshold, propose nothing.
- **The self-fulfilling score.** A carrier starved of volume stops accruing
  evidence and can never recover. A proposal that removes a carrier entirely
  should say what would have to happen for it to come back.

## Boundaries

Read-only, and proposal-only even when write tools arrive. **No policy change
reaches production routing without a human approving it** — at any autonomy
level, permanently. The system may act inside the rules; changing the rules is
a person's decision.
