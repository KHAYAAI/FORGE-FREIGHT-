# Forge Freight — console tour

An 8½-minute screen recording of `console/forge-freight-console.html`, driven by
`console/tour.mjs`. Nothing in it is mocked up: every number on screen is
computed by the same modules the API imports, and every click is a real click.

Recorded at 1600×900. The video is not committed — it is ~46 MB as VP8/WebM and
~34 MB as H.264/MP4, both over what belongs in the tree. Re-record it with:

```
node console/tour.mjs          # writes tour-out/ next to the console
```

`TOUR_OUT` sets the output directory. The run writes the video, a chapter frame
per section under `frames/`, and its own `chapters.md` with timestamps taken
from the run's clock — so the table below is regenerated rather than maintained.

The recorder is the console's harshest test. Each chapter asserts an invariant
against live state — the quote priced, the charges accrued, the invoice has
lines, the audit produced findings, the partner's screens count only the
partner's rows, the shipper's copy has no cost column — and aborts rather than
narrate a confident caption over an empty panel. It has caught real bugs: the
quote form priced against `undefined` as the tenant and returned "no valid rate
card" on lanes the operator held cards for.

## Chapters

| | Chapter | What it shows |
|---|---|---|
| `00:02` | **The desk** | One operator, one morning, a book of freight already moving |
| `00:32` | **Pricing a corridor** | The packing list is priced as you type it |
| `01:58` | **Booking** | One transaction, or none of it |
| `02:21` | **Moving the box** | Milestones are recorded, and the money follows them |
| `03:01` | **What went wrong** | Exceptions the platform raised on its own |
| `03:16` | **Clearing it** | Duty, VAT and a declaration that survives a broken channel |
| `03:47` | **The invoice** | The document a freight forwarder actually issues |
| `04:32` | **The four-way match** | Most teams check two sources. This checks four. |
| `05:03` | **Querying a line** | A dispute packet, before the window closes |
| `05:29` | **What we cannot check** | The honest answer beats a plausible number |
| `06:18` | **Every company's own invoice** | Multi-tenant down to the numbering |
| `06:40` | **A different tenant** | Same code, different predicate |
| `07:16` | **The shipper's side** | The same freight, read by the customer |
| `07:59` | **Where this leaves us** | Priced, booked, moved, cleared, billed, matched, queried, paid |

## Narration

There is none — the captions are burned in. The container has no system ffmpeg
and Playwright's bundled encoder offers only VP8 in WebM, so the recording is
silent by construction. The MP4 is a re-encode of that WebM through the ffmpeg
binary `imageio-ffmpeg` ships, for the players that will not take WebM
(PowerPoint, Keynote).
