# The console, as a single file

A working build of the operator console — the whole product in one
self-contained HTML file, seeded with a book of freight and driven by the
platform's own arithmetic. No server, no network, no build step beyond the
assembler.

It exists because the walkthrough in `demo/` shows the product and this one
*is* the product: somebody can price a corridor, book it, move it through the
lifecycle, clear it through customs, issue the standardised invoice, run the
four-way match, query a line, and read the whole thing back from the shipper's
side — without anyone provisioning Postgres, Keycloak and Redpanda first.

```bash
cd console && python3 build.py
```

Produces `forge-freight-console.html`. Open it in any browser.

## What is real

Everything in `domain.js` is ported from the platform's own pure modules —
`packing.ts`, `quote-engine.ts`, `duty-calculator.ts`, `charge-codes.ts`,
`invoice-document.ts`, `invoice-audit.ts`. Same volumetric divisors, same
margin-floor currency conversion, same per-line VAT with duty outside its
scope, same sixteen audit rules, same rounding, same integer minor units
throughout. **If a number here disagrees with the running product, one of the
two is wrong and it is worth finding out which.**

The seeded book is not hand-written rows. `populate()` in `actions.js` drives
the same mutations the buttons do — `createQuote`, `bookQuote`, `advance`,
`accrueFor`, `createEntry`, `issueInvoice`, `recordPayment`, `runAudit` — so
the freight already on screen arrived through exactly the code path the next
booking will, and a bug in accrual shows up in the seed rather than hiding
until somebody clicks something.

That has already earned its keep twice. The seed refused to build when a job
asked for an express service level against a 26-day sailing (correct — the
engine refuses what it cannot deliver), and the invoice audit fired on the
platform's own arithmetic when quoted surcharges were mislabelled as
pass-through disbursements.

## What is not real

- **The event bus, the database and the identity provider.** State lives in one
  in-memory object with an append-only event array. Reloading resets it.
- **The external systems.** All eleven are listed on the *External Systems*
  screen with what they degrade to; the fuel index and terminal gate feed can be
  toggled there, which genuinely changes what the invoice audit can check —
  turn them on and re-run a match to watch two "cannot be validated" findings
  become real comparisons.
- **The clock.** Fixed at a seeded instant and advanced by the work you do,
  not by the wall, so every figure is reproducible and ageing still moves.

## Layout

| File | What |
|---|---|
| `_tokens.css` | Palette, lifted from `apps/web/src/app/globals.css` so the two cannot drift |
| `_primitives.css` | Panels, tables, tags, tiles, timelines — shared with `demo/` |
| `shell.css` | Sidebar, topbar, toasts, the invoice document |
| `skeleton.html` | The DOM the router renders into |
| `domain.js` | Pure arithmetic, ported from the API's pure modules |
| `store.js` | Seed data, the quote engine, the lifecycle |
| `actions.js` | Every mutation, plus `populate()` which builds the book from them |
| `ui.js` | Router, navigation, tenant gating, the atoms screens are written in |
| `screens.js` / `screens2.js` | The screens |
| `boot.js` | Seat switcher, theme, the clock |

Fonts come from `../demo/fonts.css` — the same IBM Plex data URIs, inlined
because the published page runs under a CSP that blocks every external host.

## Adding a screen

1. `route(/^\/thing$/, () => head({...}) + panel({...}))` — return a string.
2. Add it to `NAV` in `ui.js` with the tenant types it belongs to.
3. Add its prefix to `mayVisit()`. **The nav is presentation; that function is
   the access control.** A customer typing the path must be sent home, not
   shown a page of error states dressed up as a screen.

Screens are pure functions of state, re-rendered wholesale. Nothing wires its
own listeners — `data-act`, `data-live` and `data-go` are delegated in `bind()`,
so no handler can survive a render that shouldn't.
