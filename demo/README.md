# Investor walkthrough

A single self-contained HTML file that runs the whole product as a narrative:
sign in as one of three tenant types, price a corridor against real rate cards,
book it, move it through the lifecycle, clear it through customs, issue the
standardised invoice, run the four-way audit over it, look at what the platform
can and cannot reach outside itself, then see the same shipment from the
shipper's side and the platform's.

Fourteen acts. Nothing is mocked at the surface: the arithmetic is the
product's own — the same volumetric divisors, the same margin floors converted
before they are compared, the same VAT treatment, the same audit rules — so the
numbers on the screen are numbers the platform would actually produce.

## Building

```bash
cd demo && python3 build.py
```

Produces `forge-freight-investor-demo.html` in the working directory. Open it
in any browser; there is no server, no build step beyond this, and no network
access at runtime.

## Why it is assembled rather than written as one file

The published page runs under a strict content-security policy that blocks
every external host, so a CDN font or a remote GeoJSON would silently fail to
load and the page would fall back to system type on someone else's screen.
Everything is therefore inlined at build time:

| File | What it is |
|---|---|
| `part1.html` | `<title>` and the entire stylesheet, with a `FONTS_PLACEHOLDER` |
| `part2.html` | The act markup — one `<section class="act">` per act |
| `part3.html` | The behaviour, with an `ASSETS_PLACEHOLDER` |
| `fonts.css` | IBM Plex Sans and Mono as `@font-face` data URIs |
| `assets.js` | Coastline geometry and port coordinates for the corridor map |

Splitting it three ways is not organisation for its own sake: the font payload
is 80 KB of base64 and the map geometry another 28 KB, and having those inline
in the file you edit makes every search and every diff useless.

## Adding an act

1. Add a `<section class="act" id="act-N">` to `part2.html`, in narrative order.
2. Add an entry to `ACTS` (or `ACTS_RAILS`) in `part3.html` and bump `LAST_ACT`.
3. Add a render function to the `RENDER` map at the same index.
4. Rebuild and click through every act — the acts share one mutable state
   object, so a change in act 4 shows up in act 8, which is the point and also
   the way to break it.
