# Hermes — the reasoning layer

Hermes reads the platform, reasons about it, and proposes. It does not act on
freight.

```
   Hermes ──MCP──► freight-mcp ──HTTPS──► Freight Core API ──► Postgres
      │                                        ▲
      │                                        │
      └── skills/  procedural knowledge        └── the only writer, always
```

Nothing here is wired up yet. The skills and configuration are written first,
deliberately, because they define what the MCP server has to expose — and a
server built before its callers tends to grow tools nobody needed and miss the
ones they did.

## Layout

| Path | What |
|---|---|
| `TOOLS.md` | The read-only tool contract. The only vocabulary skills may use |
| `config/hermes.config.yaml` | Profile, MCP connection, autonomy stance, safety bounds |
| `skills/*/SKILL.md` | Six procedures, one per job |

## The skills

| Skill | Does | Usable today |
|---|---|---|
| `pricing-analysis` | Reconstructs a quote from the card and rule that produced it | Yes |
| `carrier-selection` | Ranks valid options, explains each | Partly — no reliability data yet |
| `shipment-analysis` | Reads one shipment from its event log | Yes |
| `exception-analysis` | Diagnoses an open exception, proposes options | Yes |
| `document-analysis` | Names the missing field blocking customs | Yes |
| `post-shipment-analysis` | The learning loop | **No** — needs the outcome tables |

## Read-only, and why that is not a setting

**The MCP server exposes no write tools. None are planned for the first
version.**

The reference implementation these skills came from exposed `create_shipment`,
`accept_quote` and `book` from the start, disabled by a runtime policy flag.
That is a weaker guarantee than it looks. A flag is flipped by configuration,
by an environment variable, by someone debugging at 2am. **A tool that was
never built cannot be called at all**, by anyone, under any configuration.

So the boundary is drawn in what exists rather than in what is permitted. When
write tools are eventually justified they arrive one at a time, lowest risk
first, each with a ceiling in `config/autonomy-policy.yaml` and an entry in
`agent_actions`.

## What was adapted, and what was corrected

These six skills started as a reference set written against a different
platform. Two changes mattered more than the rest.

**The pricing model was replaced entirely.** The original taught a formula that
does not exist here — `fuel = 0.08 × base`, `handling = 1200`, a flat customs
figure. Ours is a rate card with surcharges that scale by basis
(`PER_CONTAINER`, `PER_BL`, `PERCENT_OF_FREIGHT`, `PER_SHIPMENT`), a margin
rule chosen by specificity and broken by recency, and a floor held in ZAR cents
that is converted before comparison and applies to the freight line only. A
skill carrying the wrong pricing model does not fail loudly — it produces
confident explanations that do not match the invoice, which is worse.

**Tools that do not exist were removed rather than left aspirational.**
`list_lessons`, `create_lesson`, `get_carrier_performance` and
`get_shipment_outcome` all depend on the learning slice in
`docs/target-architecture.md`. Skills now name what is missing and stop, rather
than calling a tool that will not answer.

Three principles run through all six:

- **Read the event log, not the summary field.** Status is a projection;
  events are what happened. Where they disagree, that disagreement is the
  finding.
- **Check whether an integration is configured before blaming a carrier.** A
  missing feed looks exactly like a missing milestone, and confusing them sends
  someone to chase a carrier who did nothing wrong.
- **Say "inconclusive" when it is.** A confident wrong diagnosis costs more
  than an honest one.

## Before switching this on

1. Build `services/freight-mcp/` to the contract in `TOOLS.md`.
2. Point `FREIGHT_MCP_URL` at it and give it a service credential — never a
   database URL.
3. Exercise each usable skill against a seeded database and read what it says.
   A skill that sounds right is not the same as a skill that is right, and
   these have not yet been run against real data.
4. Leave `post-shipment-analysis` disabled until the outcome tables exist.
