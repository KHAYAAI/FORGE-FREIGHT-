# External systems

A freight forwarder does not operate alone. Half the value chain lives in
somebody else's system — the revenue authority, the carrier, the terminal, the
index publisher, the identity provider — and several of those cannot be reached
by setting an environment variable. They need a registration, a licence or a
certificate that a person has to apply for.

This document says, for each one: what it does, what it needs, what happens
without it, and whether the outstanding work is configuration or paperwork.

The live version of this table is `GET /integrations`, rendered at
**Compliance → External Systems** in the console. It reads the same registry
(`apps/api/src/modules/integrations/integrations.registry.ts`), evaluates it
against the running configuration, and reports which named keys are unset. It
never reports a secret's value.

## The rule every integration follows

**Nothing here is a hard dependency of the domain logic.** Each integration is
config-gated, and each one degrades to a *stated* partial rather than to a
failure or, worse, to a plausible guess:

- The SARS channel unset does not stop a declaration being built and validated.
  It stops at `QUEUED` with the reason on it, and is exported for manual capture.
- The fuel index unset does not make the audit skip fuel lines quietly. It
  raises `FUEL_BENCHMARK_UNAVAILABLE`, states the total left unchecked, and
  names the variable that would enable the rule.
- The terminal feed unset does not let a demurrage line through. It raises
  `DEMURRAGE_UNVERIFIABLE`.

That last distinction is the point. Fuel surcharges and demurrage are two of the
highest-error categories on a forwarder invoice; a system that inferred a
benchmark it did not have would generate confident findings that collapse the
moment a vendor asks where the number came from.

---

## Customs & tax

### SARS Customs EDI — declarations

| | |
|---|---|
| **Purpose** | Lodge customs declarations (CUSDEC) and receive responses, releases and stops (CUSRES) on the same channel. |
| **Config** | `SARS_EDI_URL`, `SARS_CLIENT_NUMBER`, `SARS_CLIENT_CERT_PATH`, `SARS_CLIENT_KEY_PATH` |
| **Accreditation** | **Required.** The operating company must be registered with SARS as an importer, exporter or clearing agent and hold a **customs client number (CCN)**. It must then apply for an **EDI user profile** and be issued a **client certificate** for the gateway. This is a paper process with SARS measured in weeks. |
| **Without it** | Declarations are built, validated against the tariff book, and stored complete with a full audit trail. They stop at `QUEUED` and are exported for manual capture on eFiling. |
| **Code** | `apps/api/src/modules/integrations/sars-filing.service.ts` |

Every submission carries an idempotency key (`submission_ref`), and a network
failure leaves the filing at `QUEUED` rather than marking it rejected — the
declaration may or may not have been lodged, and the retry with the same key is
what resolves that on the authority's side. A duplicate customs entry is a
correction the operator then has to unwind with SARS by hand.

The customs client number is also printed on the face of every invoice the
company issues, so the customer's own broker can reconcile the entry against
the billing. It is set per company under **Finance → Billing Settings**.

### SARS eFiling — VAT

| | |
|---|---|
| **Purpose** | Submit VAT201 returns and read deferment account statements, so output VAT on freight invoices and import VAT recovered as a disbursement reconcile against what was actually declared. |
| **Config** | `SARS_EFILING_URL` |
| **Accreditation** | **Required.** An eFiling profile for the operating company, with the ISV/third-party access SARS grants to registered software providers. |
| **Without it** | VAT positions are computed and reported in the console for manual capture. |

---

## Invoice audit references

These exist to close the two-way/four-way matching gap. Without them the audit
runs against the contract and the shipment data only, and says so — the
`matchDepth` in every audit summary reports which of the four sources were
available, because "no exceptions" against two sources is a different claim from
the same words against four.

### Bunker / jet fuel index

| | |
|---|---|
| **Purpose** | Validate BAF, EBS and CAF lines against the index they claim to track. |
| **Config** | `FUEL_INDEX_URL`, `FUEL_INDEX_API_KEY`, `FUEL_INDEX_MAX_AGE_HOURS` |
| **Provider** | Platts or Argus (bunker), IATA (jet fuel), or a carrier's published tariff. |
| **Accreditation** | **Commercial data licence.** Platts and Argus assessments are redistributable only under subscription. Carrier-published tariffs are free but per-carrier. |
| **Without it** | `FUEL_BENCHMARK_UNAVAILABLE` on the audit, stating the total left unvalidated. |
| **Code** | `apps/api/src/modules/integrations/fuel-index.service.ts` |

Quotes are cached in `fuel_index_quotes` so a dispute raised months later can
cite the exact index level a finding was made on.

### Terminal gate events

| | |
|---|---|
| **Purpose** | Gate-in, gate-out and empty-return timestamps, so demurrage and detention are recomputed from free time instead of taken on trust. |
| **Config** | `TERMINAL_EVENTS_URL`, `TERMINAL_EVENTS_API_KEY` |
| **Provider** | Terminal operating system (Navis N4 and similar) or the carrier's equipment-history endpoint. |
| **Accreditation** | Per-terminal or per-carrier data agreement. Most terminals expose this only to registered hauliers and agents. |
| **Without it** | `DEMURRAGE_UNVERIFIABLE` on the audit. |
| **Code** | `apps/api/src/modules/integrations/terminal-events.service.ts` |

The platform's own event log is preferred where carrier track-and-trace has
already delivered `container.discharged` and `container.gated_out` — it is free,
already there, and the same record the customer sees on their timeline. The
terminal API is the fallback and the source of the empty-return timestamp, which
carriers rarely publish.

---

## Already documented elsewhere

| Integration | Config | Required for production | Notes |
|---|---|---|---|
| Denied-party screening (yente / OpenSanctions) | `YENTE_URL` | **Yes** | Parties recorded `UNSCREENED` without it. |
| Carrier track & trace (DCSA / EDIFACT / Traccar) | `INGEST_API_KEY` | **Yes** | Per-carrier credentials from each carrier's developer programme. The ingest endpoint already accepts all three formats. |
| Identity (Keycloak, OIDC) | `AUTH_ISSUER` | **Yes** | Production config refuses to start without it. |
| Event stream (Redpanda) | `KAFKA_BROKERS` | **Yes** | Events accumulate in the outbox and are never relayed without it. |
| AIS vessel positions (aisstream.io) | `AISSTREAM_API_KEY` | No | Self-serve key. |
| Document extraction (Anthropic) | `ANTHROPIC_API_KEY` | No | Everything goes to manual review without it. |
| Notifications (Novu) | `NOVU_API_KEY` | No | WhatsApp channel needs Meta sender approval; email does not. |

---

## Adding an integration

1. Add the config keys to `apps/api/src/config.ts` with a comment saying what
   breaks without them.
2. Add an entry to `INTEGRATIONS` in `integrations.registry.ts` — including
   `accreditation` if a human has to apply for something, and `degradesTo`,
   which must never be "the platform stops".
3. Build the service with an `enabled` getter and a code path that returns a
   stated null rather than a guess.
4. Add the keys to `.env.example` under a comment block.
5. The console page picks it up with no further work.
