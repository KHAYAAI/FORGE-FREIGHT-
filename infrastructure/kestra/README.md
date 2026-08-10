# Kestra — the scheduler

Kestra decides **when** work runs. It never decides **what** the work does, and
it never holds freight data.

That boundary is the whole design. Every flow here is a short YAML file that
calls an authenticated Freight Core endpoint and logs the result. The logic
lives in the API, in TypeScript, under unit test. If Kestra is switched off,
nothing is lost but the schedule — and the endpoints can still be called by
hand.

## Running it

> **Run this on your own machine.** Agent and CI containers generally have no
> Docker daemon, so nothing here can be started from one — `docker compose up -d`
> is a local step. The YAML and compose files are reviewed and committed, but
> "it started and the UI came up" is a check only you can perform.


```bash
cd infrastructure/kestra
cp .env.example .env        # fill in FREIGHT_INGEST_API_KEY
docker compose up -d
open http://localhost:8080
```

Flows are mounted read-only from `./flows`, so **git is the source of truth**.
Editing a flow in the UI will not survive a restart; change the file and commit.

## Secrets

Nothing secret is committed. `.env` is gitignored; `.env.example` carries only
placeholders. Flows read secrets as `{{ secret('NAME') }}`, which Kestra
resolves from `SECRET_NAME` in its environment.

`FREIGHT_INGEST_API_KEY` must match `INGEST_API_KEY` in the API's environment.
It is the same machine key the tracking adapters present: one shared
infrastructure secret is easier to rotate correctly than several.

## Flows

| Flow | Schedule | Calls | Replaces |
|---|---|---|---|
| `tracking/monitoring` | hourly | `POST /scheduled/sla-sweep` | `temporal/shipment-lifecycle` |
| `booking/carrier-confirmation` | hourly | `POST /scheduled/carrier-confirmation` | — |

Flows are grouped by domain (`tracking/`, `booking/`, …). `WORKFLOWS.md` has the
full design for the rest, and the rule that decides whether something belongs
here at all.

### shipment-monitoring

Asks the Freight Core which in-flight shipments have passed an SLA without the
milestone that should have cleared it:

- booked, no departure after 14 days → `CONGESTION_DELAY`
- departed, no arrival after transit + 7 days → `CONGESTION_DELAY`
- arrived, no customs release after 10 days → `CUSTOMS_QUERY`

The API raises one exception per breach and returns what it did, so the Kestra
execution log answers "what happened at 03:00 last Tuesday" without opening a
database.

**Why this is safe to schedule loosely.** The sweep is idempotent: a shipment
that already has an open exception of that code is skipped. A double run
produces no duplicate cards, and a missed run delays notice by an hour without
skipping a breach — the next run re-reads every shipment from the event log.
Freight SLAs are measured in days, so an hour costs nothing.

## Why this replaced a Temporal workflow

The previous design kept a durable workflow alive per shipment for the length
of its voyage — weeks — holding `departed`, `arrived` and `released` as live
in-memory flags.

Those flags were a second copy of facts the event log already recorded durably,
and two copies of one truth can disagree: a lost signal left the workflow
reasoning about a shipment that had already moved on. A sweep reads the log
every time it runs, so it cannot drift.

What was given up: Temporal fired at the exact SLA moment; the sweep fires
within the hour. What was gained: one fewer service to operate, no workflow
versioning to manage when an SLA changes, state in one place, and rules that
can be unit tested without Docker, a broker or a database.

## Environments

One flow, three configurations — the difference is entirely in the environment,
never in the YAML.

| | `FREIGHT_API_URL` | Notes |
|---|---|---|
| Development | `http://host.docker.internal:3000` | API on the host |
| Staging | internal service URL | Own Kestra instance and DB |
| Production | internal service URL | Never the public hostname; the sweep endpoint is not internet-facing |

For staging and production, set the same variables through your deployment's
secret manager rather than an `.env` file, and put Kestra on the internal
network with the API.

## Adding a flow

1. Add the endpoint to the API first, with its logic and unit tests there.
2. Add a YAML file to `flows/` that calls it — trigger, retry, timeout, log.
3. Confirm the task is safe to run twice. If it is not, it does not belong on a
   schedule until it is.
