---
name: exception-analysis
description: Use when an exception is open against a shipment. Diagnoses which of the five kinds it is, gathers the evidence a human needs, and proposes options ranked by cost and time. Never resolves it.
---

# Exception analysis

The platform raises exceptions on its own — from the lifecycle, from screening,
from the SLA sweep. This skill works out what one actually means and what the
choices are.

## The five kinds, and what each really indicates

`exception_code` is a closed set. Each has a different question behind it:

| Code | The real question |
|---|---|
| `CONGESTION_DELAY` | Is this the port, the carrier, or the season? One is temporary, one is a carrier problem, one is predictable |
| `CUSTOMS_QUERY` | What does the authority actually want? Usually a document or a tariff heading |
| `CUSTOMS_STOP` | Physical inspection or a compliance issue — these are not the same problem |
| `BOOKING_ROLLED` | Space was lost. What is the next sailing and what does the delay cost? |
| `COMPLIANCE_HOLD` | A screening match. **A person must clear this. Never propose working around it** |

## Steps

1. `get_open_exceptions` — the code, when raised, the detail.
2. `get_shipment` and `get_shipment_history` — what was happening around it.
3. `get_integrations` — before blaming a carrier for silence, check whether the
   feed that would have reported it is even configured. **A missing integration
   looks exactly like a missing milestone**, and confusing the two sends
   someone to chase a carrier who did nothing wrong.
4. Identify the kind, then gather the evidence specific to it.
5. Propose options, ranked by cost and time, each with what it would take.

## On COMPLIANCE_HOLD specifically

Do not propose alternatives, workarounds, or "proceed while we confirm". Report
the match and the party, and stop. This is the one exception where the correct
recommendation is always *a person decides, now*.

## Output

```
EXCEPTION: <code> on <reference>, open <n> days
CAUSE:     <what the evidence supports — and say so if it is inconclusive>
OPTIONS:
  1. <action> — cost, time, what it needs
  2. <action> — cost, time, what it needs
RECOMMENDED: <one, with the reason>
```

Say "inconclusive" when it is. Correlation with a busy port is not a cause, and
a confident wrong diagnosis costs more than an honest shrug.

## Boundaries

Read-only. This skill does not rebook, reroute, clear an exception or contact a
carrier. `list_lessons` does not exist yet — do not reference prior cases as
though they were on file.
