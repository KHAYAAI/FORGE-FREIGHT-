/* ==========================================================================
 * TOUR — records a screen walkthrough of the console.
 *
 *   node tour.mjs                     # needs playwright resolvable from here
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs node tour.mjs
 *
 * Writes forge-freight-console-tour.webm and a chapter list whose timestamps
 * come from the run's own clock, so they cannot drift from the video.
 *
 * The tour drives the real console — real clicks, real mutations, the same
 * code path a person takes. Nothing is faked for the camera, which is the
 * point: if a chapter's assertion fails the recording is thrown away rather
 * than shipped showing an empty panel under a confident caption.
 * ======================================================================== */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "forge-freight-console.html");
const OUT = process.env.TOUR_OUT || path.join(HERE, "tour-out");
const W = 1600;
const H = 900;

await fs.mkdir(path.join(OUT, "frames"), { recursive: true });
await fs.mkdir(path.join(OUT, "raw"), { recursive: true });

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: path.join(OUT, "raw"), size: { width: W, height: H } },
});
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE " + m.text()); });

const T0 = Date.now();
const chapters = [];
const clock = () => {
  const s = Math.round((Date.now() - T0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const wait = (ms) => page.waitForTimeout(ms);

/* --------------------------------------------------------------- overlay --
   Injected into <body>. render() in ui.js writes only into #view and
   renderShell() only into the chrome, so a body-level overlay survives every
   re-render and never needs re-injecting. */

async function overlay() {
  await page.addStyleTag({ content: `
    #tour-cap {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 9000;
      padding: 22px 46px 26px; pointer-events: none;
      background: linear-gradient(to top, rgba(4,7,12,.94) 42%, rgba(4,7,12,0));
      font: 500 21px/1.45 "IBM Plex Sans", system-ui, sans-serif;
      color: #eef2f7; letter-spacing: -.01em;
      opacity: 0; transition: opacity .32s ease;
      text-shadow: 0 1px 14px rgba(0,0,0,.75);
    }
    #tour-cap.on { opacity: 1; }
    #tour-cap b { color: #7cc7ff; font-weight: 600; }
    #tour-chapter {
      position: fixed; inset: 0; z-index: 9100; pointer-events: none;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; background: rgba(4,7,12,.97);
      opacity: 0; transition: opacity .45s ease;
      font-family: "IBM Plex Sans", system-ui, sans-serif;
    }
    #tour-chapter.on { opacity: 1; }
    #tour-chapter .n {
      font: 600 12px/1 "IBM Plex Mono", monospace; letter-spacing: .22em;
      text-transform: uppercase; color: #7cc7ff;
    }
    #tour-chapter .t { font: 300 52px/1.1 "IBM Plex Sans", system-ui, sans-serif; color: #f4f7fb; letter-spacing: -.02em; }
    #tour-chapter .s { font: 400 18px/1.4 "IBM Plex Sans", system-ui, sans-serif; color: #93a1b4; max-width: 720px; text-align: center; }
    #tour-cursor {
      position: fixed; z-index: 9050; width: 22px; height: 22px; margin: -11px 0 0 -11px;
      border-radius: 50%; pointer-events: none; opacity: 0;
      background: rgba(124,199,255,.28); border: 2px solid rgba(124,199,255,.95);
      box-shadow: 0 0 0 6px rgba(124,199,255,.09);
      transition: opacity .3s ease, transform .12s ease;
    }
    #tour-cursor.tap { transform: scale(.6); background: rgba(124,199,255,.6); }
  ` });

  await page.evaluate(() => {
    const mk = (id, html = "") => {
      const n = document.createElement("div");
      n.id = id; n.innerHTML = html;
      document.body.appendChild(n);
      return n;
    };
    const cap = mk("tour-cap");
    const ch = mk("tour-chapter", `<div class="n"></div><div class="t"></div><div class="s"></div>`);
    const cur = mk("tour-cursor");
    cur.style.left = "800px"; cur.style.top = "500px";

    window.__tour = {
      cap, ch, cur,
      pos: { x: 800, y: 500 },
      say(html) { cap.innerHTML = html; cap.classList.add("on"); },
      hide() { cap.classList.remove("on"); },
      chapter(n, title, sub) {
        ch.querySelector(".n").textContent = n;
        ch.querySelector(".t").textContent = title;
        ch.querySelector(".s").textContent = sub || "";
        ch.classList.add("on");
      },
      chapterOff() { ch.classList.remove("on"); },
      /* Eased so the eye can follow it. A cut to a new cursor position reads
         as a jump; a move reads as an intention. */
      move(x, y, ms) {
        return new Promise((res) => {
          const a = { ...this.pos }, t0 = performance.now();
          this.cur.style.opacity = "1";
          const step = (t) => {
            const k = Math.min(1, (t - t0) / ms);
            const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            this.cur.style.left = (a.x + (x - a.x) * e) + "px";
            this.cur.style.top = (a.y + (y - a.y) * e) + "px";
            if (k < 1) requestAnimationFrame(step);
            else { this.pos = { x, y }; res(); }
          };
          requestAnimationFrame(step);
        });
      },
      tap() {
        this.cur.classList.add("tap");
        setTimeout(() => this.cur.classList.remove("tap"), 190);
      },
    };
  });
}

/* ----------------------------------------------------------- narration -- */

/* Reading pace, not a flat constant — a nine-word caption held as long as a
   forty-word one either rushes the viewer or bores them. */
const readMs = (t) => Math.max(2200, Math.min(9000, t.replace(/<[^>]+>/g, "").split(/\s+/).length * 300));

async function say(html, hold) {
  await page.evaluate((h) => window.__tour.say(h), html);
  await wait(hold || readMs(html));
}
async function clear(ms = 260) {
  await page.evaluate(() => window.__tour.hide());
  await wait(ms);
}

async function chapter(title, sub) {
  const n = chapters.length + 1;
  await clear(200);
  await page.evaluate(([a, b, c]) => window.__tour.chapter(a, b, c),
    [`Chapter ${String(n).padStart(2, "0")}`, title, sub]);
  chapters.push({ n, title, sub, at: clock() });
  await wait(2100);
  await page.evaluate(() => window.__tour.chapterOff());
  await wait(600);
  console.log(`${chapters[chapters.length - 1].at}  ${String(n).padStart(2, "0")}. ${title}`);
}

/* ------------------------------------------------------------- driving -- */

const nav = async (hash, ms = 700) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await wait(ms);
};

async function point(sel, ms = 620) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await wait(180);
  const b = await el.boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.evaluate(([a, c, d]) => window.__tour.move(a, c, d), [x, y, ms]);
  await wait(ms + 120);
  return { x, y };
}

async function clickAt(sel, after = 850) {
  const { x, y } = await point(sel);
  await page.evaluate(() => window.__tour.tap());
  await page.mouse.click(x, y);
  await wait(after);
}

async function typeInto(sel, text, delay = 55) {
  await point(sel, 420);
  await page.locator(sel).first().click();
  await page.locator(sel).first().fill("");
  await page.locator(sel).first().pressSequentially(String(text), { delay });
  await wait(260);
}

async function setNum(sel, v) {
  await page.locator(sel).first().fill(String(v));
  await page.locator(sel).first().dispatchEvent("input");
  await wait(170);
}

/* A slow read down a long screen. The console's own scroll, not a jump. */
async function readDown(px = 700, ms = 1500) {
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await wait(ms / steps);
  }
  await wait(320);
}
async function readUp(ms = 700) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await wait(ms);
}

async function seat(userId, name) {
  await page.locator("#who").click();
  await wait(500);
  await clickAt(`#menu button[data-user="${userId}"]`, 900);
  const who = await page.locator("#who").innerText();
  if (!who.toLowerCase().includes(name.toLowerCase()))
    throw new Error(`seat switch failed: expected ${name}, topbar says ${who}`);
}

const state = (fn, arg) => page.evaluate(fn, arg);

function must(cond, msg) {
  if (!cond) throw new Error("ASSERTION — " + msg);
}

async function frame(label) {
  const f = path.join(OUT, "frames", `${String(chapters.length).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: f });
}

/* ========================================================== the tour ==== */

await page.goto("file://" + SRC, { waitUntil: "load" });
await wait(1200);
await overlay();

try {
  /* -- 1 ------------------------------------------------------------- */
  await chapter("The desk", "One operator, one morning, a book of freight already moving");
  await nav("/");
  await say("This is <b>Forge Freight</b> — a freight forwarding platform running on seeded data. "
    + "Nothing here is a mock-up: every figure on screen was produced by the same arithmetic the API runs.");
  await say("The dashboard is what an operator sees at 07:00 — live shipments, open exceptions, and cash "
    + "that has been invoiced but not yet received.");
  await readDown(520);
  await say("Ageing, dispute windows and free time all move with the work, not with the wall clock, "
    + "so every number in this recording is reproducible.");
  await readUp();
  await frame("dashboard");
  await clear();

  /* -- 2 ------------------------------------------------------------- */
  await chapter("Pricing a corridor", "The packing list is priced as you type it");
  await nav("/quotes/new");
  await say("A quote starts with what is actually in the box. Most systems ask for a weight. "
    + "This one asks for the packing list, because the carrier bills whichever is larger.");
  await typeInto('input[data-k="description"]', "Knitted cotton shirts, 100% cotton, retail packed");
  await say("Two lines on the packing list — cartons, then a palletised line with dimensions.");

  await typeInto('input[data-live="item"][data-i="0"][data-k="description"]', "Cartons, knitted shirts", 40);
  await setNum('input[data-live="item"][data-i="0"][data-k="pieces"]', 480);
  await setNum('input[data-live="item"][data-i="0"][data-k="weightKg"]', 5760);
  await setNum('input[data-live="item"][data-i="0"][data-k="l"]', 60);
  await setNum('input[data-live="item"][data-i="0"][data-k="w"]', 40);
  await setNum('input[data-live="item"][data-i="0"][data-k="h"]', 38);
  await point(".tile.accent");
  await say("Chargeable weight moved as those dimensions landed. The tiles recompute on every keystroke — "
    + "same volumetric divisors as the API's <b>packing.ts</b>.");

  await clickAt('[data-act="addItem"]');
  await typeInto('input[data-live="item"][data-i="1"][data-k="description"]', "Palletised display units", 40);
  await setNum('input[data-live="item"][data-i="1"][data-k="pieces"]', 24);
  await setNum('input[data-live="item"][data-i="1"][data-k="weightKg"]', 410);
  await setNum('input[data-live="item"][data-i="1"][data-k="l"]', 120);
  await setNum('input[data-live="item"][data-i="1"][data-k="w"]', 100);
  await setNum('input[data-live="item"][data-i="1"][data-k="h"]', 145);

  const measured = await state(() => {
    const t = [...document.querySelectorAll("#view .tile .v")].slice(-4).map((n) => n.textContent);
    return { pieces: t[0], gross: t[1], vol: t[2], chargeable: t[3] };
  });
  must(measured.pieces === "504", `pieces should read 504, reads ${measured.pieces}`);
  await point(".tile.accent");
  await say(`<b>${measured.pieces} pieces</b>, ${measured.gross} gross, ${measured.vol} — and the platform bills `
    + `<b>${measured.chargeable}</b>. That gap is the difference between a quote that holds and one that loses money.`);

  await page.locator('select[data-k="urgency"]').selectOption("EXPRESS").catch(() => {});
  await wait(700);
  await say("Set the urgency to express and the engine now has a transit ceiling to honour — "
    + "it will refuse a card it cannot deliver against rather than quote a date it will miss.");
  await clickAt('[data-act="price"]', 1400);

  const priced = await state(() => (typeof QF === "undefined" ? null
    : QF.result ? { carrier: QF.result.card.carrier }
    : QF.error ? { error: QF.error.message } : null));
  if (priced && priced.error) {
    await say("The engine refused: <b>" + priced.error + "</b> — which is the correct answer. Back to standard service.");
    await page.locator('select[data-k="urgency"]').selectOption("STANDARD");
    await wait(600);
    await clickAt('[data-act="price"]', 1400);
  }
  const ok = await state(() => !!(typeof QF !== "undefined" && QF.result));
  must(ok, "the quote engine produced no result");
  const q = await state(() => ({ carrier: QF.result.card.carrier, days: QF.result.transitDays, lines: QF.result.lines.length }));
  await say(`Priced. <b>${q.carrier}</b>, ${q.days} days, ${q.lines} charge lines — cheapest valid card on the lane, `
    + "the most specific margin rule, and every surcharge priced on its own basis: per container, per kilo, per document, per cent of freight.");
  await readDown(420);
  await frame("quote");
  await clear();

  /* -- 3 ------------------------------------------------------------- */
  await chapter("Booking", "One transaction, or none of it");
  await typeInto("#bookref", "MSCU-2026-44810", 45);
  await say("The carrier's own reference goes on before anything is written.");
  await clickAt('[data-act="book"]', 1600);
  const landed = await state(() => location.hash);
  must(/#\/shipments\//.test(landed), `booking should open a shipment, landed on ${landed}`);
  await say("Booking wrote the quote acceptance, the consignment, the shipment and the first charge accrual "
    + "in one transaction. Either all of it happened or none of it did.");
  await readDown(600);
  await readUp();
  await frame("booked");
  await clear();

  /* -- 4 ------------------------------------------------------------- */
  await chapter("Moving the box", "Milestones are recorded, and the money follows them");
  await say("Charges are not typed in. They are accrued by consumers listening to the lifecycle — "
    + "so the invoice can only ever contain things that actually happened.");
  /* Scoped to this shipment. Counting S.charges globally says nothing about
     what the clicks did, and only some milestones carry an accrual — a
     discharge does, a vessel departure does not. */
  const here = () => state(() => {
    const s = shipmentOf(location.hash.match(/#\/shipments\/(.+)$/)[1]);
    return { step: s.step, charges: S.charges.filter((c) => c.shipmentId === s.id).length,
      events: S.events.filter((e) => e.shipmentId === s.id).length };
  });
  const before = await here();
  for (let i = 0; i < 5; i++) {
    await clickAt('[data-act="advance"]', 900);
  }
  const after = await here();
  must(after.step === before.step + 5, `five clicks moved the lifecycle ${after.step - before.step} steps`);
  must(after.events > before.events, "milestones recorded no events");
  await say(`Five milestones recorded, <b>${after.events - before.events} events</b> appended, `
    + `${after.charges > before.charges
        ? `and <b>${after.charges - before.charges} more charges</b> accrued on their own`
        : "and nothing new billed — these particular milestones carry no accrual, which is the point: "
          + "charges follow events that cost money"}.`);
  await readDown(520);
  await say("Pass-through, marked-up or forwarder-originated: the provenance is recorded per line, at accrual, "
    + "not reconstructed at invoice time.");
  await readUp();
  await frame("milestones");
  await clear();

  /* -- 5 ------------------------------------------------------------- */
  await chapter("What went wrong", "Exceptions the platform raised on its own");
  await nav("/ops");
  await say("Nobody filed these. The lifecycle raised them — a carrier that dropped a port call, "
    + "a SARS query on a tariff heading, a counterparty that matched a watchlist.");
  await readDown(500);
  await readUp();
  await frame("ops");
  await clear();

  /* -- 6 ------------------------------------------------------------- */
  await chapter("Clearing it", "Duty, VAT and a declaration that survives a broken channel");
  await nav("/customs");
  const entry = await page.locator("tbody tr[data-go]").first().getAttribute("data-go");
  must(entry, "no customs entry to open");
  await clickAt("tbody tr[data-go]", 1100);
  await say("A customs entry, priced off the SARS tariff book. "
    + "VAT is charged on the added-tax value — customs value plus duty plus a 10% upliftment — "
    + "not on the invoice value. Computing it the easy way understates every entry.");
  await readDown(420);
  const unconfirmed = await page.locator('[data-act="confirmLine"]').count();
  if (unconfirmed) {
    await clickAt('[data-act="confirmLine"]', 1000);
    await say("Confirming a line means a human took responsibility for the classification. "
      + "The tariff search proposes; it does not decide.");
  }
  await readUp();
  const lodge = await page.locator('[data-act="lodgeFiling"]').count();
  if (lodge) {
    await clickAt('[data-act="lodgeFiling"]', 1300);
    await say("The declaration is built, validated and stored — and it stops at <b>QUEUED</b> with the reason on it, "
      + "because the SARS EDI channel needs an accredited client number this deployment does not have. "
      + "A working state, not a broken one.");
  }
  await frame("customs");
  await clear();

  /* -- 7 ------------------------------------------------------------- */
  await chapter("The invoice", "The document a freight forwarder actually issues");
  await nav("/invoices");
  await say("A forwarder invoice is a consolidated billing document — the forwarder's own services, "
    + "the carrier's charges passed through, and statutory disbursements, on one page.");
  await clickAt("tbody tr[data-go]", 1200);
  const inv = await state(() => {
    const m = location.hash.match(/#\/invoices\/(.+)$/);
    if (!m) return null;
    const i = S.invoices.find((x) => x.id === m[1]);
    return i ? { number: i.number, total: i.totalCents, lines: S.charges.filter((c) => c.invoiceId === i.id).length } : null;
  });
  must(inv && inv.lines > 0, "opened an invoice with no lines");
  await say(`<b>${inv.number}</b>. Charges grouped by category in a fixed order, each line carrying its code, `
    + "its basis, its quantity and where it came from.");
  await readDown(650);
  await say("Three totals, not one: what we originated, what we marked up, and what we passed through at cost. "
    + "A customer who can see that split stops asking whether they are being marked up on port charges.");
  await readDown(650);
  await say("And a notice on every one: this is <b>not</b> a commercial invoice and <b>not</b> a bill of lading. "
    + "Those are different documents doing different jobs, and conflating them is how customs entries go wrong.");
  await readUp();
  await frame("invoice");
  await clear();

  /* -- 8 ------------------------------------------------------------- */
  await chapter("The four-way match", "Most teams check two sources. This checks four.");
  await say("Roughly eighty per cent of freight invoices carry a discrepancy, and overcharges run eight to ten per cent. "
    + "The usual defence is a two-way match: invoice against rate card.");
  await clickAt('[data-act="audit"]', 1800);
  const audit = await state(() => {
    const m = location.hash.match(/#\/invoices\/(.+)$/);
    const f = S.invoiceExceptions.filter((x) => x.invoiceId === m[1]);
    return { n: f.length, codes: f.map((x) => x.code) };
  });
  must(audit.n > 0, "the audit produced no findings");
  await say(`Contract, vendor cost or published benchmark, the shipment's own facts, and the service event record — `
    + `<b>${audit.n} findings</b> on this invoice.`);
  await readDown(600);
  await say("Findings annotate the invoice. They do not block it — because a forwarder who cannot bill until "
    + "every query is closed simply stops running the audit.");
  await frame("audit");
  await clear();

  /* -- 9 ------------------------------------------------------------- */
  await chapter("Querying a line", "A dispute packet, before the window closes");
  const disputable = await page.locator('[data-act="dispute"]').count();
  if (disputable) {
    await clickAt('[data-act="dispute"]', 1100);
    await say("Queried. Held back from the balance and flagged — not quietly netted off, "
      + "which is how disputes get lost.");
  }
  const packetBtn = await page.locator('[data-act="packet"]').count();
  if (packetBtn) {
    await clickAt('[data-act="packet"]', 1400);
    await readDown(560);
    await say("The packet is what goes to the carrier: the lines, the variance, the evidence, "
      + "and the days left in the dispute window. Raised at month-end, it is raised after the window closed.");
  }
  await frame("dispute");
  await clear();

  /* -- 10 ------------------------------------------------------------ */
  await chapter("What we cannot check", "The honest answer beats a plausible number");
  await nav("/integrations");
  await say("Eleven external systems, each listed with what it degrades to when it is not configured — "
    + "and the accreditation you need before it can be.");
  await readDown(520);
  await readUp();
  await say("Two of those findings said a line <b>could not be validated</b> rather than inventing a benchmark. "
    + "Turn the feeds on and watch them become real comparisons.");
  await clickAt('[data-act="toggleInt"][data-k="fuel_index"]', 900);
  await clickAt('[data-act="toggleInt"][data-k="terminal"]', 900);
  await nav("/invoices");
  await clickAt("tbody tr[data-go]", 1000);
  const auditBtn = await page.locator('[data-act="audit"]').count();
  must(auditBtn > 0, "no audit button on the invoice after enabling feeds");
  await clickAt('[data-act="audit"]', 1800);
  const depth = await state(() => {
    const m = location.hash.match(/#\/invoices\/(.+)$/);
    const f = S.invoiceExceptions.filter((x) => x.invoiceId === m[1]);
    return { codes: f.map((x) => x.code), n: f.length };
  });
  await say(`Re-run against a live fuel index and a terminal gate clock. `
    + `The surcharge is now compared against a published figure and the demurrage days against real gate timestamps.`);
  await readDown(600);
  await say("Turn them off and it goes back to saying so. It never guesses.");
  await frame("integrations");
  await clear();

  /* -- 11 ------------------------------------------------------------ */
  await chapter("Every company's own invoice", "Multi-tenant down to the numbering");
  await nav("/billing/settings");
  await say("Every company on the platform issues its own document — its legal entity, VAT number, "
    + "banking details, payment terms and branding.");
  await readDown(520);
  await say("Numbering is per company and gapless, allocated inside the transaction that issues the invoice. "
    + "Two invoices raised in the same second cannot collide, and a tax authority will not accept a gap.");
  await readUp();
  await frame("billing-settings");
  await clear();

  /* -- 12 ------------------------------------------------------------ */
  await chapter("A different tenant", "Same code, different predicate");
  await seat("u-4", "Nadia");
  await say("Nadia works for a partner agency in Cape Town. Same build, same screens — "
    + "and a tenant predicate applied at the query layer, not in the navigation.");
  await nav("/rates");
  /* Two tables on this screen — buy side then sell side. Count them separately;
     a total across both would pass while showing her somebody else's margins. */
  const partnerRates = await state(() => {
    const rows = (i) => (document.querySelectorAll("#view table")[i]
      ?.querySelectorAll("tbody tr").length ?? -1);
    return {
      shownCards: rows(0), shownRules: rows(1),
      theirs: S.rateCards.filter((c) => c.tenantId === "t-pa").length,
      theirRules: S.marginRules.filter((r) => r.tenantId === "t-pa").length,
      operators: S.rateCards.filter((c) => c.tenantId === "t-op").length,
    };
  });
  must(partnerRates.shownCards === partnerRates.theirs,
    `partner sees ${partnerRates.shownCards} rate cards, owns ${partnerRates.theirs}`);
  must(partnerRates.shownRules === partnerRates.theirRules,
    `partner sees ${partnerRates.shownRules} margin rules, owns ${partnerRates.theirRules}`);
  await say(`Her rate cards — <b>${partnerRates.theirs}</b> of them. The operator's ${partnerRates.operators} are not `
    + "here, and were not here before either; a partner pricing off the house's buy rates is a leak, not a feature.");
  await nav("/shipments");
  await readDown(400);
  await say("Her book, her margin rules, her invoices. Typing a path she has no business on sends her home — "
    + "the sidebar is presentation, the check is access control.");
  await frame("partner");
  await clear();

  /* -- 13 ------------------------------------------------------------ */
  await chapter("The shipper's side", "The same freight, read by the customer");
  await seat("u-5", "Ayanda");
  await say("Ayanda is the shipper. She has no roles at all — the portal is a different product "
    + "reading the same records.");
  await nav("/track");
  await readDown(420);
  await clickAt("tbody tr[data-go]", 1100);
  await say("Her shipment, its milestones, its documents — and none of the buy rates, margin rules "
    + "or vendor costs that sit one table away.");
  await readDown(560);
  await nav("/track/invoices");
  await readDown(320);
  await clickAt("tbody tr[data-go]", 1100);
  const portalDoc = await state(() => ({
    lines: document.querySelectorAll("#view .doc tbody tr").length,
    cols: [...document.querySelectorAll("#view .doc th")].map((n) => n.textContent.trim()),
  }));
  must(portalDoc.lines > 0, "the portal invoice document rendered no lines");
  must(!portalDoc.cols.includes("Cost"),
    `the shipper's copy is showing a cost column: ${portalDoc.cols.join(", ")}`);
  await say("The same document the forwarder issued, charge for charge — and no cost column, "
    + "because the assembler was never handed the costs rather than a column being hidden.");
  await readDown(480);
  await frame("portal");
  await clear();

  /* -- 14 ------------------------------------------------------------ */
  await chapter("Where this leaves us", "Priced, booked, moved, cleared, billed, matched, queried, paid");
  await seat("u-1", "Thabo");
  await nav("/");
  await say("Everything in that walkthrough ran on the platform's own arithmetic — the same packing, quoting, "
    + "duty, invoice and audit modules the API imports.");
  await say("What is missing is deliberate and named: the accredited channels. SARS EDI, a fuel index licence, "
    + "terminal feeds. The code is built against them and degrades honestly without them.");
  await say("<b>Forge Freight.</b> The invoice, the compliance and the audit trail a freight forwarder actually needs.");
  await wait(1200);
  await frame("close");
  await clear(900);
} catch (e) {
  console.error("\nTOUR FAILED at chapter " + chapters.length + ": " + e.message);
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  await ctx.close();
  await browser.close();
  process.exit(1);
}

/* ---------------------------------------------------------------- close -- */

const secs = Math.round((Date.now() - T0) / 1000);
const video = page.video();
await ctx.close();
const raw = await video.path();
const final = path.join(OUT, "forge-freight-console-tour.webm");
await fs.rename(raw, final);
await browser.close();

const size = (await fs.stat(final)).size;
const lines = [
  "# Forge Freight — console tour",
  "",
  `Recorded from \`console/forge-freight-console.html\` by \`console/tour.mjs\`.`,
  `Duration ${Math.floor(secs / 60)} min ${secs % 60} s · ${W}×${H} · ${(size / 1048576).toFixed(1)} MB · VP8/WebM.`,
  "",
  "| | Chapter | What it shows |",
  "|---|---|---|",
  ...chapters.map((c) => `| \`${c.at}\` | **${c.title}** | ${c.sub} |`),
  "",
];
await fs.writeFile(path.join(OUT, "chapters.md"), lines.join("\n"));

console.log(`\nvideo   ${final}  (${(size / 1048576).toFixed(1)} MB, ${secs}s)`);
console.log(`errors  ${errors.length ? "\n  " + [...new Set(errors)].join("\n  ") : "none"}`);
if (errors.length) process.exit(2);
