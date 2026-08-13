# freight-mcp

A read-only MCP server over the Freight Core API. It is how an agent — Hermes,
or anything else that speaks MCP — reads the platform.

```
   agent ──MCP (stdio or HTTP)──► freight-mcp ──GET + agent key──► Freight Core API ──► Postgres
```

The server holds **no database credentials**, and there is no code here that
would use one. Every request goes through the same authenticated API a person
uses — via a dedicated agent-auth path in `jwt.guard.ts` that binds the caller
to exactly one tenant — so tenant scoping, role checks and rate limits apply
to the agent exactly as they apply to a human. There is no faster path,
because none is built.

## Read-only, checked rather than asserted

There is no `method` field on a tool definition, no way to pass a verb, and no
code path that issues anything but `GET`. Two tests hold that in place: one
drives every tool through a fake fetch and asserts the set of HTTP methods used
is exactly `{GET}`, another asserts no request ever carries a body.

That is a stronger guarantee than a policy flag. A flag is flipped by
configuration, by an environment variable, by someone debugging at 2am. **A
capability that was never built cannot be used by anyone under any
configuration**, and if someone does add a write path, the test goes red.

## Running it — locally, over stdio

```bash
cp .env.example .env      # fill in FREIGHT_MCP_AGENT_KEY and FREIGHT_MCP_TENANT_ID
pnpm --filter @forge-freight/freight-mcp build
node dist/main.js
```

Logs go to **stderr** — stdout is the protocol channel, and writing anything
else there corrupts the stream.

To connect it to Claude Code locally:

```bash
claude mcp add freight -- node /absolute/path/to/services/freight-mcp/dist/main.js
```

## Running it — as a remote server, over HTTP

Set `MCP_TRANSPORT=http` (and optionally `MCP_HTTP_PORT`, default `9000`).
The server then listens on `POST /mcp` — a stateless
`StreamableHTTPServerTransport`, a fresh one per request, since read-only tool
calls have no multi-turn state worth holding onto — plus `GET /healthz` for a
plain liveness check. This is the mode `infra/aws/mcp.tf` deploys to ECS
Fargate: Fargate cannot give a container the interactive stdio channel a
locally-spawned child process gets, so a persistent HTTP server is the only
way to reach it from a remote agent host.

```bash
MCP_TRANSPORT=http node dist/main.js
curl -s http://localhost:9000/healthz          # → ok
```

## Authentication

Every request carries two headers: `x-agent-key` (must equal `AGENT_API_KEY`
on the API) and `x-agent-tenant-id` (this instance's one tenant, set once via
`FREIGHT_MCP_TENANT_ID` — never supplied by the caller). One instance, one
tenant — the same shape `infrastructure/n8n` already uses, for the same
reason: a malformed or hostile tool call cannot read across tenants when the
tenant is server-side configuration, not something the request carries.

The API's guard (`apps/api/src/modules/auth/jwt.guard.ts`) is opt-in and
fails closed: an unset `AGENT_API_KEY` means this path never activates —
normal Bearer/dev auth for everyone else is unaffected either way. On a
match, the request is granted `roles: ["ops"]`, which is exactly what the
read-only tool surface needs and nothing more.

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

The tool surface, the read-only guarantee, header and correlation-id
behaviour, credential redaction, timeout handling, error classification, and
configuration refusing to start without what it needs — including the
tenant-id shape and the transport switch. The API side of the auth path
(`apps/api/test/jwt-guard-agent.test.ts`) is tested in `apps/api`, since it is
API code, not this server's.

Integration tests against a live API are not written yet, and the tools have
not been exercised against real data. Reads-correctly and works-correctly are
different claims; only the first is currently supported.
