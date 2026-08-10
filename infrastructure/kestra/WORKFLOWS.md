# The Kestra workflows — what they are and why each exists

One flow is built. The rest are designed here, grounded in the state machines
and endpoints that actually exist, so they can be implemented one at a time
without re-deciding the architecture each time.

---

## The rule that decides what belongs here

Kestra answers **when**. It never answers **what**.

Every flow is a short YAML file that calls an authenticated Freight Core
endpoint and logs the result. The rules live in TypeScript, under unit test,
where they can be exercised in milliseconds without Docker or a broker. If
Kestra is switched off, nothing is lost but the schedule — every endpoint can
still be called by hand.

A candidate workflow has to pass three tests:

**1. Is the trigger *time*, rather than an event?**
This is the one that disqualifies most candidates. The platform already has an
event spine: 28 domain events, an outbox, and five consumers with independent
watermarks. Anything that should happen *because something happened* already
has a home, and putting it in Kestra adds a hop and a second place to look.

Kestra's proper subject is the opposite case: **noticing that something has
not happened.** No event fires when a vessel fails to arrive. Absence has no
event, so absence needs a clock.

**2. Is it safe to run twice?**
The schedule is allowed to be unreliable. A missed run should cost latency, a
double run should cost nothing. If a task cannot meet that, it does not belong
on a timer until it can.

**3. Does the answer already live behind an endpoint?**
If the logic would have to live in YAML to work, it is in the wrong place.

---

## What does not belong here

Worth stating plainly, because these were proposed and the reasons are
specific to this codebase.

### Quote acceptance, and carrier booking as a pair

`bookings.service.ts:95` wraps the whole booking in one `db.transaction`:
`QuoteAccepted` and `ShipmentBooked` are emitted together, with the
consignment, the shipment, the legs and the first charge accrual. The comment
above it reads *"projections and both events — lands in one transaction."*

There is no interval between quote acceptance and booking for a scheduler to
occupy. Creating one means splitting that transaction, which destroys the
guarantee that a shipment, its cargo and its first charges either all exist or
none do. **Not a scheduling problem, and not worth breaking the core to make
into one.**

### Document validation, as an event chain

`DocumentUploaded → extract → review queue` is already event-driven and already
built. Kestra has nothing to add to the happy path. What it *can* add is the
absence case — see **document-chase** below.

### Pickup coordination

Needs a carrier or haulier integration that does not exist. The part that is
real today — *booked, but the box never reached the terminal* — is already
phase 1 of `shipment-monitoring`.

---

## Group A — deadlines nobody is watching

The largest group, and the most valuable. Every one asks the same shape of
question: **what should have happened by now, and did not?**

### 1. `shipment-monitoring` — **BUILT**

| | |
|---|---|
| Cadence | Hourly |
| Endpoint | `POST /scheduled/sla-sweep` ✅ |
| Replaces | `temporal/shipment-lifecycle` |

Three checks against the event log:

- booked, no `vessel.departed` after 14 days → `CONGESTION_DELAY`
- departed, no arrival after transit + 7 days → `CONGESTION_DELAY`
- arrived, no `entry.released` after 10 days → `CUSTOMS_QUERY`

**Why schedulable.** The trigger is the *non-arrival* of a milestone. There is
no event for a vessel that failed to sail.

**Idempotency.** One open exception per code per shipment. A shipment already
carrying an open `CONGESTION_DELAY` is skipped, so an hourly run cannot produce
a wall of duplicate cards.

**Known parity gap.** `bookings.service.ts` starts the old workflow with
`transitDays: null` hardcoded, so the transit budget has always fallen back to
30 days. The sweep reproduces that deliberately, so old and new agree. Wiring
the real per-lane transit is a follow-up, and should be done to both or
neither.

---

### 2. `quote-expiry` — the same defect as `OVERDUE`, one table over

| | |
|---|---|
| Cadence | Hourly |
| Endpoint | `POST /scheduled/expire-quotes` — **to build** |
| Writes | `quotes.status` → `EXPIRED` |

`quote_status` has had `EXPIRED` in the enum from the start. **Nothing ever
writes it.** A quote past its `validUntil` still sits in the book as `ISSUED`.

This is not a booking bug — `assertBookable` checks `validUntil < now` directly
and refuses, so nobody can book at a stale price. It is a *reporting* bug, and
it is precisely the defect the overdue sweep was written to fix. From
`overdue-sweep.service.ts`:

> The status was in the enum from the start and the console already rendered it
> — a red badge, its own filter, an "overdue" count on the invoices screen —
> but nothing ever wrote it. The count was permanently zero, which is worse
> than absent: the screen asserted that nothing was late.

Same sentence applies here with the nouns changed. A pipeline that counts dead
quotes as live is a pipeline that lies.

**Idempotency.** `UPDATE ... WHERE status = 'ISSUED' AND valid_until < now()`.
Second run matches nothing.

---

### 3. `dispute-window` — the one with money attached

| | |
|---|---|
| Cadence | Daily |
| Endpoint | `POST /scheduled/dispute-window-check` — **to build** |
| Reads | `invoice_exceptions` where `status = 'OPEN'` |

`invoice-assembly.service.ts` builds a dispute packet with
`disputeWindowDays = 30`, and the packet itself carries *"Dispute window: N
day(s) remaining"*. The comment beside it notes what a packet assembled after
the window closed is worth: nothing.

Nothing watches that countdown. An audit finding raised on day 1 and forgotten
is unrecoverable on day 31 — **the overcharge silently becomes your cost.**

The flow asks: which open findings are inside their last few days, and has
anybody sent the packet? Escalate before the door shuts, not after.

**Why this is the highest-value flow after monitoring.** Every other sweep
protects a number on a screen. This one protects cash, on a deadline that
cannot be reopened.

**Idempotency.** Escalate once per finding per threshold crossed (e.g. at 7
days and at 2 days), recorded on the finding.

---

### 4. `invoice-overdue` — already running, worth moving

| | |
|---|---|
| Cadence | Hourly |
| Today | `OverdueSweepService`, in-process `setInterval` |

Already built and correct. Listed for completeness and because there is a
choice to make: leave it in-process, or move it behind
`POST /scheduled/mark-overdue` so that **every scheduled job in the system is
visible in one place**.

For a solo maintainer that consolidation is worth something — "what runs on a
timer, and did it run?" becomes one screen instead of grep. Not urgent.

---

### 5. `document-chase` — paperwork that stopped moving

| | |
|---|---|
| Cadence | Daily |
| Endpoint | `POST /scheduled/document-chase` — **to build** |
| Reads | `documents` where `review_status` in (`PENDING_EXTRACTION`, `PENDING_REVIEW`) |

Two different stalls, and they need different answers:

- **`PENDING_EXTRACTION` for hours** — extraction failed or was never
  configured. A machine problem. Alert the operator of the platform.
- **`PENDING_REVIEW` for days** — a human queue nobody is working. A staffing
  problem. Alert the operator of the *business*.

Without it, a missing bill of lading surfaces when the box is on the quay and
the delay is already expensive.

**Note.** The audit found that a rejected document emits no event at all —
`documents.controller.ts` accepts `APPROVED | REJECTED` but only
`DocumentApproved` exists. Fix `DocumentRejected` before building this, or the
chase will keep chasing documents that were already refused.

---

### 6. `customs-stalled` — two very different silences

| | |
|---|---|
| Cadence | Daily |
| Endpoint | `POST /scheduled/customs-stalled` — **to build** |
| Reads | `customs_entries`, `compliance_filings` |

`customs_entry_status` runs `DRAFT → PREPARED → SUBMITTED → QUERY → RELEASED /
STOPPED`, and `filing_status` runs `DRAFT → QUEUED → SUBMITTED → ACKNOWLEDGED →
QUERIED → ACCEPTED / REJECTED`.

Two stalls matter, and conflating them would be a mistake:

- **`SUBMITTED`, no response for N days** — SARS has it and has gone quiet.
  Chase the authority.
- **`QUEUED`, indefinitely** — the EDI channel is not configured, so the
  declaration is sitting in the platform waiting to be lodged by hand. That is
  the documented degradation, not a fault; but "correctly waiting" and
  "forgotten" look identical after a week.

The second is the interesting one: it turns an honest limitation into an
actionable list, which is the difference between a system that degrades
gracefully and one that degrades quietly.

---

### 7. `exception-ageing` — the kanban nobody cleared

| | |
|---|---|
| Cadence | Daily |
| Endpoint | `POST /scheduled/exception-ageing` — **to build** |
| Reads | `shipment_exceptions` where `cleared_at is null` |

`shipment-monitoring` raises exceptions. Nothing notices when one is never
cleared. An ops board that only grows stops being read, and then the platform
has a full kanban and a blind operator.

Escalate by age and severity — `exception_severity` already has `INFO / WARN /
CRITICAL` to key off.

---

### 8. `delivery-completion` — and where `ShipmentClosed` comes from

| | |
|---|---|
| Cadence | Daily |
| Endpoint | `POST /scheduled/close-shipments` — **to build** |
| Emits | `ShipmentClosed` — **the missing event** |

Two questions:

- **Delivered, no `pod.confirmed`** — proof of delivery is what makes the
  invoice defensible. Chase it while the driver still remembers.
- **Delivered, invoiced, paid, all exceptions cleared → close it.** The
  catalogue currently ends at `PaymentReceived`. `PodConfirmed` is delivery, not
  commercial closure, so **nothing marks a job finished.**

That gap is why the learning loop has no trigger. A postmortem needs an event
that says *this shipment is done, here is what it cost and how long it took*.
This flow is where it comes from, which makes it a prerequisite for everything
in Group C.

**Idempotency.** A shipment already closed is skipped; `ShipmentClosed` carries
the shipment id as its `sourceRef`, so the `(type, source_ref)` unique index
enforces once-only at the database.

---

## Group B — keeping external data fresh

### 9. `fuel-index-refresh`

| | |
|---|---|
| Cadence | Daily |
| Endpoint | `POST /scheduled/refresh-fuel-index` — **to build** |
| Writes | `fuel_index_quotes` |

`FuelIndexService.benchmarkFor()` refreshes lazily — the first audit of the day
pays for the fetch, and if the provider is slow or down, the audit reports
"could not be validated" for a reason that has nothing to do with the invoice.

Pre-fetching on a schedule separates *"we have no licence for this index"* (a
real, permanent answer) from *"the provider timed out just now"* (weather).
Those look the same to an operator today, and they should not.

### 10. `compliance-rescreening` — the one with regulatory teeth

| | |
|---|---|
| Cadence | Daily |
| Endpoint | `POST /scheduled/rescreen-parties` — **to build** |
| Reads | `parties` |

**Nothing re-screens anybody.** A party is screened when created, and
`screening_status` (`UNSCREENED / CLEAR / REVIEW / HIT`) is then frozen
forever.

Sanctions lists change. A counterparty cleared in March can be listed in
August, and the platform will keep quoting, booking and invoicing them without
a murmur — because the only screening that ever ran was months ago.

This is the purest example of the category: **the trigger is time itself.** No
event in this system will ever fire, because the change happened in someone
else's database. That is exactly what a scheduler is for, and it is the flow I
would build first after the money one.

Raise a `COMPLIANCE_HOLD` on any party whose status worsens, and let the
existing exception machinery surface it.

---

## Group C — later, for the learning layer

Not yet, and deliberately: they depend on `ShipmentClosed` from flow 8 and on
the outcome tables from `docs/target-architecture.md`.

| Flow | Cadence | Purpose |
|---|---|---|
| `outcome-reconcile` | daily | Turn closed shipments into expected-vs-actual rows |
| `scorecard-rebuild` | nightly | Recompute carrier × lane reliability from outcomes |
| `simulator-batch` | on demand | Run synthetic shipments and measure whether the loop actually learns |

`scorecard-rebuild` is the case where Kestra is a genuinely better fit than
Temporal: a nightly recomputation over a table is a data job, and data jobs are
what it was built for.

---

## Suggested order

Not the order they are listed. Value first, and each one small enough to finish
in a sitting.

| # | Flow | Why now |
|---|---|---|
| 1 | `shipment-monitoring` | ✅ done |
| 2 | `compliance-rescreening` | Regulatory exposure, and nothing covers it at all |
| 3 | `dispute-window` | Real money, on a deadline that cannot be reopened |
| 4 | `quote-expiry` | Small, and fixes a screen that currently lies |
| 5 | `delivery-completion` | Unblocks the entire learning layer |
| 6 | `customs-stalled` | Turns honest degradation into an actionable list |
| 7 | `exception-ageing` | Only worth it once several flows are filling the board |
| 8 | `document-chase` | Wait for `DocumentRejected` first |
| 9 | `fuel-index-refresh` | Small quality-of-life gain |
| 10 | `invoice-overdue` | Optional consolidation of something already working |

Two of these — `compliance-rescreening` and `dispute-window` — protect against
losses the business would currently never learn about. Everything else improves
a screen.

## Building one

1. Write the rules as a pure function in the API, with unit tests. No database
   needed to test them.
2. Add the endpoint under `/scheduled/`, guarded by the machine key.
3. Confirm it is safe to call twice, and write the test that proves it.
4. Add the YAML: trigger, retry, timeout, log, error branch.
5. Nothing business-related goes in the YAML. If it must, step 1 is unfinished.
