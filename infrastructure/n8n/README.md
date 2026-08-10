# n8n — the loading dock

n8n faces the outside world. Email, WhatsApp, CRM, carrier portals, partner
webhooks — it sorts that mess and hands the Freight Core clean, structured
requests.

It is **not** the system of record and **not** the shipment state machine.

Those rules are enforced by what n8n is given, not by policy: this compose file
contains no Freight Core database credentials, so a workflow cannot write to
PostgreSQL even if someone tried. Its only route in is an authenticated API key
against the Freight Core API.

## Running it

> **Run this on your own machine.** Agent and CI containers generally have no
> Docker daemon, so nothing here can be started from one — `docker compose up -d`
> is a local step. The YAML and compose files are reviewed and committed, but
> "it started and the UI came up" is a check only you can perform.


```bash
cd infrastructure/n8n
cp .env.example .env        # fill in the key, tenant id and encryption key
docker compose up -d
open http://localhost:5678
```

Import `workflows/customer-rfq.json` from the UI. Workflow JSON lives in git —
export and commit after changing anything, so the file stays the source of
truth rather than whatever is in the container.

## One instance per tenant

`FREIGHT_TENANT_ID` is configuration, not something read from the message. The
mailbox n8n watches belongs to exactly one forwarder, so putting the tenant in
the environment means a malformed or hostile email cannot raise a quote on
another company's book.

## Workflows

| Workflow | Trigger | Calls |
|---|---|---|
| `customer-rfq` | webhook (`POST /webhook/customer-rfq`) | `POST /ingest/rfq` |

### Customer RFQ → Freight Core

```
RFQ arrives
   ↓
normalise + require a messageId
   ↓
POST /ingest/rfq          ← 30s timeout, 3 tries, 5s apart
   ↓
switch on the answer
   ├── QUOTED                  → respond with the quote
   ├── NEEDS_ONBOARDING        → hand to a person
   ├── NEEDS_SCREENING_REVIEW  → hand to a person
   ├── NO_RATE                 → tell the customer
   └── anything else           → dead letter, visibly
```

The webhook is a stand-in for a Gmail/IMAP trigger. Everything downstream reads
the same fields, so connecting a real mailbox does not change the rest.

**Retries are safe.** The API keys the quote on `rfq:<messageId>`, and the
`(type, source_ref)` unique index on the events table means a repeated call
returns the original quote rather than issuing a second one. That is also why
the workflow refuses an RFQ with no message id: without a stable key, a
redelivered enquiry becomes a second quote to the same customer for the same
freight.

**Four outcomes, all HTTP 200.** A refused RFQ is a business answer, not a
transport failure. Returning 5xx for "we hold no rate on that lane" would have
n8n retrying something that is never going to price.

**An unknown sender is never onboarded automatically.** Creating a party runs
denied-party screening, which is asynchronous — so auto-creating and
immediately quoting would issue a price before anyone knows whether the
counterparty is sanctioned. Unknown senders, and parties still under review,
go to a person. This is the human-in-the-loop point of the whole workflow, and
it is enforced in the API rather than in the workflow, so it holds no matter
what calls it.

## Secrets

Nothing secret is committed; `.env` is gitignored and `.env.example` carries
placeholders only. `FREIGHT_INGEST_API_KEY` must match `INGEST_API_KEY` in the
API's environment.

`N8N_ENCRYPTION_KEY` encrypts stored credentials at rest — generate once per
environment and keep it stable, because changing it orphans every saved
credential.

## Environments

| | `FREIGHT_API_URL` | Notes |
|---|---|---|
| Development | `http://host.docker.internal:3000` | API on the host |
| Staging | internal service URL | Own instance, own database |
| Production | internal service URL | Never the public hostname |

For staging and production, supply these through the deployment's secret
manager rather than an `.env` file, and keep n8n on the internal network with
the API.

## Testing

The workflow is four nodes of plumbing. What has to be right is the contract
underneath it, and that is covered by
`apps/api/test-integration/rfq-intake.test.ts` — resolution, both refusals, the
no-rate answer, and the idempotency that makes a redelivered email safe:

```bash
pnpm dev:infra
DATABASE_URL=postgres://forge:forge@localhost:5432/forge_freight pnpm --filter @forge-freight/api test:integration
```

Then drive the workflow end to end with a real HTTP call:

```bash
curl -X POST http://localhost:5678/webhook/customer-rfq \
  -H 'content-type: application/json' \
  -d '{
    "messageId": "<CAF=1@mail.example>",
    "customerEmail": "exports@overbergfruit.example",
    "origin": "CNSHA",
    "destination": "ZADUR",
    "mode": "OCEAN",
    "containerType": "40HC",
    "quantity": 2,
    "incoterm": "CIF"
  }'
```

Send it twice. The second call returns the same `quoteId` with
`"duplicate": true`, and the events table still holds exactly one
`quote.issued` for that message.

## Adding a workflow

1. Add or confirm the Freight Core endpoint first, with its rules and tests
   there — n8n should carry plumbing, never business rules.
2. Build the workflow, then export the JSON into `workflows/` and commit it.
3. Give every HTTP node a timeout and a retry policy, and confirm the endpoint
   is safe to call twice.
4. Give every branch an explicit destination, including the unexpected one. A
   status the workflow does not recognise should be visible, not silently
   treated as success.
