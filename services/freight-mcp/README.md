# freight-mcp

A read-only MCP server over the Freight Core API. It is how an agent — Hermes,
or anything else that speaks MCP — reads the platform.

```
   agent ──MCP/stdio──► freight-mcp ──GET + service key──► Freight Core API ──► Postgres
```

The server holds **no database credentials**, and there is no code here that
would use one. Every request goes through the same authenticated API a person
uses, so tenant scoping, role checks and rate limits apply to the agent exactly
as they apply to a human. There is no faster path, because none is built.

## Read-only, checked rather than asserted

There is no `method` field on a tool definition, no way to pass a verb, and no
code path that issues anything but `GET`. Two tests hold that in place: one
drives every tool through a fake fetch and asserts the set of HTTP methods used
is exactly `{GET}`, another asserts no request ever carries a body.

That is a stronger guarantee than a policy flag. A flag is flipped by
configuration, by an environment variable, by someone debugging at 2am. **A
capability that was never built cannot be used by anyone under any
configuration**, and if someone does add a write path, the test goes red.

## Running it

```bash
cp .env.example .env      # fill in FREIGHT_MCP_API_KEY
pnpm --filter @forge-freight/freight-mcp build
node dist/main.js
```

It speaks MCP over stdio. Logs go to **stderr** — stdout is the protocol
channel, and writing anything else there corrupts the stream.

To connect it to Claude Code locally:

```bash
claude mcp add freight -- node /absolute/path/to/services/freight-mcp/dist/main.js
```

## Tools

Thirteen, all read-only. `hermes/TOOLS.md` is the contract and explains what
each is for; this list is the implementation of it.

`get_shipment` · `list_shipments` · `get_shipment_history` · `get_quote` ·
`get_customer` · `get_rate_cards` · `get_margin_rules` · `get_documents` ·
`get_customs_entry` · `get_invoice` · `get_invoice_findings` ·
`get_open_exceptions` · `get_integrations`

### Tools that do not exist yet

`get_carrier_performance`, `get_shipment_outcome`, `list_lessons` and
`create_lesson` all wait on the learning slice in
`docs/target-architecture.md`. Asking for one returns a specific answer naming
what it waits on, rather than a generic unknown-tool error — so an agent stops
instead of substituting a different tool and presenting the result as though it
were the one requested.

## Errors an agent can act on

A reasoning loop that cannot tell a permanent refusal from a blip will retry
the wrong things. So failures come back as content with `isError`, carrying a
kind and a `retryable` flag:

| Kind | Means | Retry? |
|---|---|---|
| `NOT_FOUND` | It does not exist | No — the answer will not change |
| `NOT_PERMITTED` | This credential may not see it | No — escalate to a person |
| `NOT_CONFIGURED` | A feature or integration is off | No — not a fault |
| `INVALID_INPUT` | The arguments were wrong | Fix and re-ask |
| `UPSTREAM` | Failed or timed out | Yes |

## Correlation ids

Every call carries `x-correlation-id`, logged here and sent to the API. When
someone asks what an agent did at 14:02, the answer is a grep rather than an
inference. The credential is never logged; there is a test for that.

## Tests

```bash
pnpm --filter @forge-freight/freight-mcp test
```

21 tests: the tool surface, the read-only guarantee, header and correlation-id
behaviour, credential redaction, timeout handling, error classification, and
configuration refusing to start without what it needs.

Integration tests against a live API are not written yet, and the tools have
not been exercised against real data. Reads-correctly and works-correctly are
different claims; only the first is currently supported.
