---
name: shipment-analysis
description: Use when reviewing one shipment — where it is, what it has cost, what is at risk. Reads the event log rather than summary fields, and names what it cannot see.
---

# Shipment analysis

A short operational readout for one shipment, assembled from read-only tools.

## Read the log, not the label

`get_shipment` gives a status. `get_shipment_history` gives the events that
status was derived from, and they are the ground truth — status is a
projection. When the two disagree, the log is right and the disagreement is
itself the finding.

## Steps

1. `get_shipment` — lane, incoterm, equipment, current status, legs.
2. `get_shipment_history` — the milestones actually recorded, with their
   timestamps. Note both `occurredAt` (when it happened) and `recordedAt`
   (when we learned it): a carrier reporting Tuesday's departure on Friday is
   normal in freight, and the gap between the two is often the story.
3. `get_open_exceptions` — what has already been raised against it.
4. `get_documents` — anything still waiting on a human.
5. `get_customs_entry` — where the declaration stands, if there is one.

## What to look for

- **Milestones that have not arrived.** Booked with no departure, sailed with
  no arrival, landed with no release. The absence is the signal; the SLA sweep
  raises these, but the pattern is worth reading.
- **A widening gap between `occurredAt` and `recordedAt`.** A carrier reporting
  later and later is usually a carrier losing control of the box.
- **Documents blocking customs.** Check what the entry needs against what has
  been approved.
- **An exception raised and never cleared.** How long has it been open?

## Output

Six bullets at most, then one line:

```
RECOMMENDED ACTION: <the single most useful next step, and who does it>
```

If nothing needs doing, say so. Manufacturing an action for every shipment
trains the reader to skip the line.

## Boundaries

Read-only. Describes and recommends; changes nothing.
