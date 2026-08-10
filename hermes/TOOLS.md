# The Freight MCP tool surface

The contract the MCP server (`services/freight-mcp/`, not yet built) will
implement, and the only vocabulary the skills in this directory may use.

Written before the server so the skills and the server agree from the start,
rather than the skills naming tools that turn out not to exist.

## Read-only, and not as a setting

**Every tool below is read-only. There are no write tools, and none are
planned for the first version.**

This is stronger than it sounds, and the distinction matters. A reference
implementation we reviewed exposed `create_shipment`, `accept_quote` and
`book` from the start, disabled by a runtime policy flag. A flag is a weaker
guarantee than absence: a flag can be flipped by configuration, by an
environment variable, by someone debugging at 2am. **A tool that was never
built cannot be called at all.**

So the agent's reach is bounded by what exists in the server, not by what a
setting permits. When write tools are eventually justified, they arrive one at
a time, each with a policy ceiling in `config/autonomy-policy.yaml`, each
audited to `agent_actions`, and the lowest-risk ones first.

## How a tool reaches the data

```
  Hermes ──MCP──► freight-mcp ──HTTPS + service credential──► Freight Core API ──► Postgres
```

The MCP server holds **no database credentials**. It is an HTTP client against
the same authenticated API a human uses, so tenant scoping, role checks and
rate limits apply to the agent exactly as they apply to a person. There is no
faster path, because none is built.

## Tools

Backed by endpoints that exist today:

| Tool | Endpoint | Returns |
|---|---|---|
| `get_shipment` | `GET /shipments/:id` | Status, lane, incoterm, legs, containers, consignment |
| `list_shipments` | `GET /shipments` | A page of the book, newest first |
| `get_shipment_history` | `GET /shipments/:id/events` | The event log for one shipment — the closest thing to ground truth |
| `get_quote` | `GET /quotes/:id` | Lines with buy, sell and currency |
| `get_customer` | `GET /parties/:id` | Name, country, screening status |
| `get_rate_cards` | `GET /rates/cards` | This tenant's buy side, with validity and surcharges |
| `get_margin_rules` | `GET /rates/margin-rules` | The sell side, with specificity |
| `get_documents` | `GET /documents/review-queue` | What is waiting on a human |
| `get_customs_entry` | `GET /customs/entries/by-shipment/:id` | Declaration, duty, VAT, state |
| `get_invoice` | `GET /invoices/:id/document` | The assembled document as issued |
| `get_invoice_findings` | `GET /invoices/:id/exceptions` | Four-way match findings |
| `get_open_exceptions` | `GET /ops/exceptions` | The ops kanban |
| `get_integrations` | `GET /integrations` | Which external systems are configured, and what each degrades to |

Not yet available, and skills must not call them:

| Tool | Blocked on |
|---|---|
| `get_carrier_performance` | `carrier_scorecards`, from the learning slice in `docs/target-architecture.md` |
| `get_shipment_outcome` | `shipment_outcomes`, same slice |
| `list_lessons` / `create_lesson` | The proposal lifecycle. Lessons are `policy_proposals`, and a proposal a human has not approved must not be readable as fact |

A skill that needs one of these says so in plain words and stops. It does not
guess, and it does not substitute a different tool and pretend.

## Requirements on the server

- TypeScript, matching the rest of the repo.
- Input validation with zod at the boundary — the same schemas the API uses
  where they can be shared.
- Structured errors that distinguish *not found*, *not permitted*, *not
  configured* and *upstream failed*. An agent that cannot tell these apart will
  retry the wrong ones.
- Per-request timeouts, so a slow upstream cannot hang a reasoning loop.
- A correlation id per call, propagated to the API and logged at both ends.
- Every call logged to `agent_actions`: agent id, tool, arguments, verdict,
  outcome. **An action that cannot be reconstructed afterwards is a defect** —
  freight is a regulated trade.
- No secrets in source. The service credential comes from the environment.
- Unit tests for validation and error mapping; integration tests against a real
  API instance.
