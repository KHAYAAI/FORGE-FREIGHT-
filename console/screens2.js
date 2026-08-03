/* ==========================================================================
 * SCREENS — finance, audit, billing identity, the portal, the rails
 * ======================================================================== */

/* ============================================================== invoices */

route(/^\/invoices$/, () => {
  markOverdue(S);
  const invs = S.invoices.filter((i) => i.tenantId === tenantOf(S));
  const open = invs.filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
  const owed = open.reduce((a, i) => a + Math.max(0, outstanding(i)), 0);
  const overdue = invs.filter((i) => i.status === "OVERDUE");
  const unaudited = invs.filter((i) => !i.auditedAt);

  return head({ eyebrow: "Finance", title: "Invoices",
    lede: "Charges are written by the event consumers as the freight moves — nobody keys them in. An invoice is a grouping of uninvoiced charges by currency, and a payment is only ever counted once however many times the bank redelivers it." })

  + `<div class="grid g4" style="margin-bottom:16px">
      ${tile("Invoices", String(invs.length))}
      ${tile("Owed", money(owed), { tone: owed ? "warn" : "good", sub: `${open.length} unsettled` })}
      ${tile("Overdue", String(overdue.length), { tone: overdue.length ? "bad" : "good" })}
      ${tile("Not yet audited", String(unaudited.length), { tone: unaudited.length ? "warn" : "good",
        sub: "Match before payment, not at month-end" })}
    </div>`

  + panel({ flush: true, body: table(
      [{ label: "Number" }, { label: "Customer" }, { label: "Shipment" }, { label: "Total", align: "r" },
       { label: "Paid", align: "r" }, { label: "Outstanding", align: "r" }, { label: "Due" },
       { label: "Status" }, { label: "Audit" }],
      invs.map((i) => { const s = shipmentOf(i.shipmentId); const paid = paidOn(S, i.id);
        const findings = S.invoiceExceptions.filter((x) => x.invoiceId === i.id && (x.status === "OPEN" || x.status === "DISPUTED"));
        return `<tr class="rowlink" data-go="/invoices/${i.id}">
          <td><span class="mono" style="color:var(--accent-strong)">${esc(i.number)}</span></td>
          <td class="p">${esc(i.billTo.name)}</td>
          <td><span class="mono small">${esc(s ? s.reference : "—")}</span></td>
          <td class="r tab p">${money(i.totalCents, i.currency)}</td>
          <td class="r tab">${paid ? money(paid, i.currency) : "—"}</td>
          <td class="r tab ${outstanding(i) > 0 ? "p" : "muted"}">${money(Math.max(0, outstanding(i)), i.currency)}</td>
          <td class="mono" style="font-size:11px">${day(i.dueDate)}</td>
          <td>${invTag(i.status)}</td>
          <td>${i.auditedAt
            ? (findings.length ? tag(`${findings.length} open`, "warn", true) : tag("Clean", "good", true))
            : tag("Not run")}</td></tr>`; }),
      { emptyTitle: "No invoices yet", emptyBody: "Issue one from a shipment's charges." }) });
});

/* ------------------------------------------------------ the document ---- */

route(/^\/invoices\/(.+)$/, (id) => {
  const inv = S.invoices.find((x) => x.id === id);
  if (!inv || inv.tenantId !== tenantOf(S)) return empty("Not found", "This invoice either doesn't exist or isn't yours.");
  const lines = invoiceLines(S, inv.id);
  const doc = buildDocument(inv, lines, { commercial: true });
  const paid = paidOn(S, inv.id);
  const s = shipmentOf(inv.shipmentId);
  const cons = s ? S.consignments.find((c) => c.id === s.consignmentId) : null;
  const findings = S.invoiceExceptions.filter((x) => x.invoiceId === inv.id);
  const profile = S.billingProfiles[inv.tenantId];
  const missing = profileCompleteness(inv.issuer).missing;
  const payments = S.payments.filter((p) => p.invoiceId === inv.id);

  return head({ eyebrow: "Finance", title: inv.number,
    lede: `Freight invoice to ${esc(inv.billTo.name)}`,
    actions: `<button class="btn" data-act="printInv">Print</button>` })
  + `<div style="margin-bottom:12px">${back("/invoices", "All invoices")}</div>`

  + (missing.length ? `<div class="note warn" style="margin-top:0">
      <b>This document is incomplete for the issuing company.</b> Missing: ${esc(missing.join("; "))}.
      Fill these in under <a href="#/billing/settings">Billing Settings</a> before sending it.
      </div>` : "")

  + `<article class="doc" id="doc">
      <div class="doc-head">
        <div>
          <div class="doc-issuer">${esc(inv.issuer.tradingName || inv.issuer.legalName)}</div>
          <div class="small muted">${esc(inv.issuer.legalName)}</div>
          <div class="small muted" style="margin-top:7px;white-space:pre-line">${esc(inv.issuer.addressLines || "—")}</div>
          <div class="small muted" style="margin-top:7px">
            ${inv.issuer.registrationNumber ? `Reg <span class="mono">${esc(inv.issuer.registrationNumber)}</span>` : ""}
            ${inv.issuer.vatNumber ? ` · VAT <span class="mono">${esc(inv.issuer.vatNumber)}</span>` : ""}
            ${inv.issuer.customsClientNumber ? ` · Customs client <span class="mono">${esc(inv.issuer.customsClientNumber)}</span>` : ""}
          </div>
        </div>
        <div style="text-align:right">
          <div class="eyebrow">Freight invoice</div>
          <div class="doc-num">${esc(inv.number)}</div>
          <div style="margin-top:7px">${invTag(inv.status)}</div>
          <div class="small muted" style="margin-top:8px">
            Issued ${day(inv.createdAt)}<br>
            Due ${day(inv.dueDate)} · net ${inv.paymentTermsDays} days<br>
            ${inv.customerReference ? `Your reference <span class="mono">${esc(inv.customerReference)}</span>` : ""}
          </div>
        </div>
      </div>

      <div class="two-col" style="margin-top:16px">
        <div class="panel" style="background:var(--inset);box-shadow:none">
          <div class="eyebrow mute" style="margin-bottom:6px">Bill to</div>
          <div class="p" style="font-size:13px;font-weight:500">${esc(inv.billTo.name)}</div>
          ${inv.billTo.addressLines ? `<div class="small muted" style="margin-top:4px;white-space:pre-line">${esc(inv.billTo.addressLines)}</div>` : ""}
          ${inv.billTo.taxId ? kv("VAT", `<span class="mono">${esc(inv.billTo.taxId)}</span>`) : ""}
          ${inv.billTo.email ? kv("Email", esc(inv.billTo.email)) : ""}
        </div>
        ${s ? `<div class="panel" style="background:var(--inset);box-shadow:none">
          <div class="eyebrow mute" style="margin-bottom:6px">Shipment</div>
          ${kv("Reference", `<span class="mono">${esc(s.reference)}</span>`)}
          ${kv("Routing", `<span class="mono">${esc(lane(s))}</span>`)}
          ${kv("Incoterm", esc(s.incoterm))}
          ${kv("Bill of lading", inv.blNumber ? `<span class="mono">${esc(inv.blNumber)}</span>` : `<span class="muted">not recorded</span>`)}
          ${kv("Containers", `<span class="mono">${esc(s.containers.map((c) => c.number || `(${c.type})`).join(", "))}</span>`)}
        </div>` : ""}
      </div>

      ${cons ? `<div class="panel" style="background:var(--inset);box-shadow:none;margin-top:14px">
        <div class="eyebrow mute" style="margin-bottom:5px">Goods</div>
        <div class="p" style="font-size:12.5px">${esc(cons.description)}</div>
        <div class="row small muted" style="gap:18px;margin-top:6px">
          <span>${num(cons.pieces)} pieces</span><span>${kg(cons.grossWeightGrams)} gross</span>
          <span>${cbm(cons.volumeCm3)}</span>
          <span class="p">${kg(cons.chargeableWeightGrams)} chargeable</span>
        </div></div>` : ""}

      <div class="scroll-x" style="margin-top:18px"><table class="tbl">
        <thead><tr><th>Charge</th><th>Basis</th><th class="r">Qty</th><th class="r">Unit</th>
          <th class="r">Cost</th><th class="r">Amount</th><th class="r">VAT</th></tr></thead>
        <tbody>${doc.sections.map((sec) => `
          <tr><td colspan="7" class="eyebrow mute" style="padding-top:12px">${esc(sec.label)}</td></tr>
          ${sec.lines.map((l) => `<tr>
            <td><span class="mono muted" style="font-size:10.5px">${esc(l.code)}</span>
              <span class="p">${esc(l.description)}</span>
              ${l.disputed ? tag("Queried", "warn") : ""}
              <div style="margin-top:3px">${tag(PROV_LABEL[l.prov], PROV_TAG[l.prov])}
              ${l.vendorName ? `<span class="small muted" style="margin-left:6px">${esc(l.vendorName)}${l.vendorInvoiceRef ? " · " + esc(l.vendorInvoiceRef) : ""}</span>` : ""}</div></td>
            <td class="muted">${esc(basisPhrase(l.basis))}</td>
            <td class="r tab">${l.qty}</td>
            <td class="r tab muted">${l.unitSellCents == null ? "—" : money(l.unitSellCents, inv.currency)}</td>
            <td class="r tab muted">${l.buyCents == null ? "—" : money(l.buyCents, inv.currency)}</td>
            <td class="r tab p">${money(l.sellCents, l.currency)}</td>
            <td class="r tab muted">${l.vatBps ? money(l.vatCents, inv.currency) : `<span class="small">Zero-rated</span>`}</td>
          </tr>`).join("")}
          <tr><td colspan="5" class="r muted" style="font-size:11.5px">${esc(sec.label)} subtotal</td>
            <td class="r tab p">${money(sec.sub, inv.currency)}</td>
            <td class="r tab muted">${money(sec.vat, inv.currency)}</td></tr>`).join("")}
        </tbody></table></div>

      <div class="two-col" style="margin-top:18px">
        <div>
          <div class="eyebrow mute" style="margin-bottom:8px">How this invoice is made up</div>
          ${[["Disbursements, recovered at cost", doc.totals.passThrough],
             ["Third-party services", doc.totals.markedUp],
             ["Our own services", doc.totals.own]].map(([l, v]) => `
            <div class="split-row" style="margin-bottom:6px">
              <span class="lbl">${esc(l)}</span>
              <span class="meter" style="flex:1"><i style="width:${doc.totals.sub ? Math.max(0, (v / doc.totals.sub) * 100) : 0}%"></i></span>
              <span class="amt p">${money(v, inv.currency)}</span></div>`).join("")}
          <p class="small muted" style="margin:10px 0 0">
            The split no forwarder invoice in the market carries. It is the answer to
            &ldquo;what am I actually paying you for&rdquo;, printed rather than argued about.</p>
          ${(() => {
            /* Margin on service revenue, not on the whole invoice. Money
               advanced to an authority and recovered at cost is not revenue,
               and leaving it in the denominator makes a healthy job read as a
               1.7% business. Stated rather than quietly excluded. */
            const service = doc.lines.filter((l) => !(l.prov === "PASS_THROUGH" && l.buyCents === l.sellCents));
            const sell = service.reduce((a, l) => a + l.sellCents, 0);
            const buy = service.reduce((a, l) => a + (l.buyCents ?? 0), 0);
            const m = sell - buy;
            const advanced = doc.totals.sub - sell;
            return `<p class="small muted" style="margin:8px 0 0">
              Margin ${money(m, inv.currency)} on ${money(sell, inv.currency)} of service revenue
              (${sell ? ((m / sell) * 100).toFixed(1) : "0.0"}%).
              ${advanced ? `${money(advanced, inv.currency)} of this invoice is money advanced to third parties and
              recovered at cost — it carries no margin and is excluded here rather than flattering
              or deflating the ratio.` : ""}
              ${doc.margin.linesWithoutBuy ? `${doc.margin.linesWithoutBuy} line(s) have no recorded cost, so their margin is unknowable rather than total.` : ""}</p>`;
          })()}
        </div>
        <div>
          ${kv("Subtotal", money(doc.totals.sub, inv.currency))}
          ${kv(`VAT @ ${pct(inv.issuer.vatBps)}`, money(doc.totals.vat, inv.currency))}
          ${kv("Total", `<span class="accent">${money(doc.totals.total, inv.currency)}</span>`, "tot")}
          ${paid ? kv("Paid", "− " + money(paid, inv.currency)) : ""}
          ${paid ? kv("Balance due", money(inv.totalCents - paid, inv.currency), "tot") : ""}
          ${doc.totals.disputed ? kv("Of which under query", `<span style="color:var(--warning)">${money(doc.totals.disputed, inv.currency)}</span>`) : ""}
          <div class="small muted" style="margin-top:12px">
            ${inv.issuer.bankName ? `${esc(inv.issuer.bankName)} · <span class="mono">${esc(inv.issuer.bankAccountNumber)}</span>
              · branch <span class="mono">${esc(inv.issuer.bankBranchCode)}</span> · <span class="mono">${esc(inv.issuer.bankSwift)}</span><br>`
              : `<span style="color:var(--warning)">No bank account is recorded on this invoice.</span><br>`}
            Payment reference <span class="mono">${esc(inv.number)}</span></div>
        </div>
      </div>

      ${doc.currencies.length > 1 ? `<div class="note warn">This invoice carries lines in
        ${esc(doc.currencies.join(", "))}. The totals above are not meaningful until each currency
        is billed on its own document.</div>` : ""}

      <div class="doc-notice">
        ${inv.issuer.invoiceFooter ? `<p style="margin:0 0 8px;color:var(--t2)">${esc(inv.issuer.invoiceFooter)}</p>` : ""}
        ${esc(DOC_NOTICE)}
      </div>
    </article>

    <div class="two-col" style="margin-top:16px">
      ${panel({ eyebrow: "Accounts receivable", title: "Payments", flush: true, body:
        table([{ label: "Reference" }, { label: "Received" }, { label: "Amount", align: "r" }],
          payments.map((p) => `<tr class="${p.fresh ? "new-row" : ""}">
            <td><span class="mono p">${esc(p.paymentRef)}</span></td>
            <td class="muted">${stamp(p.receivedAt)}</td>
            <td class="r tab p">${money(p.amountCents, p.currency)}</td></tr>`),
          { emptyTitle: "Nothing received", emptyBody: "Record a payment below as it settles." })
        + `<div style="padding:13px 16px 16px">
            <div class="row" style="align-items:flex-end">
              <label class="field" style="flex:1;min-width:110px"><span>Amount</span>
                <input class="ctl tab" id="payamt" type="number" step="0.01" value="${(Math.max(0, outstanding(inv)) / 100).toFixed(2)}"></label>
              <label class="field" style="flex:1;min-width:140px"><span>Bank reference *</span>
                <input class="ctl mono" id="payref" placeholder="FNB-2026-…"></label>
              <button class="btn primary" data-act="pay" data-id="${inv.id}">Record payment</button>
            </div>
            <p class="small muted" style="margin:9px 0 0">
              The reference is the bank's, and it is unique per invoice — recording it twice changes
              nothing and emits nothing. Before that existed, two half payments left an invoice
              part-paid forever and a redelivered webhook credited the customer twice.</p>
          </div>` })}

      ${auditPanel(inv, findings)}
    </div>`;
});

ACTIONS.printInv = () => window.print();

ACTIONS.pay = (n) => {
  if (!hasRole(S, "finance")) return toast("bad", "Refused", "Recording a payment needs the finance role.");
  const inv = S.invoices.find((x) => x.id === n.dataset.id);
  const ref = ($("#payref").value || "").trim();
  const amt = Math.round(Number($("#payamt").value || 0) * 100);
  if (!ref) return toast("bad", "A reference is required",
    "It is what makes a redelivered payment a no-op rather than a second credit.");
  if (amt <= 0) return toast("bad", "Enter the amount received", "");
  const r = recordPayment(S, inv.id, { amountCents: amt, paymentRef: ref });
  if (r.duplicate) toast("info", "Already recorded",
    `${ref} was already applied to ${inv.number}. Nothing changed, and no second event was emitted.`);
  else if (r.overpaidCents > 0) toast("warn", "Overpaid",
    `${inv.number} is settled with ${money(r.overpaidCents, inv.currency)} to refund — that is money owed back, not revenue.`);
  else toast("good", "Payment recorded",
    r.outstandingCents > 0 ? `${money(r.outstandingCents, inv.currency)} still outstanding.` : "Settled in full.");
  render();
};

/* ------------------------------------------------------------ the audit - */

const SOURCES = [
  { k: "CONTRACT", label: "Contract", sub: "The accepted quote's own lines" },
  { k: "VENDOR_COST", label: "Vendor cost", sub: "Recorded buy, or a published index" },
  { k: "SHIPMENT_DATA", label: "Shipment data", sub: "Containers, documents, weights" },
  { k: "SERVICE_EVENTS", label: "Service events", sub: "Did the billed thing happen" },
];

const LAST_AUDIT = {};

function auditPanel(inv, findings) {
  const a = LAST_AUDIT[inv.id];
  const open = findings.filter((f) => f.status === "OPEN" || f.status === "DISPUTED");
  const queryable = open.reduce((t, f) => t + Math.max(0, f.variance || 0), 0);

  return panel({ eyebrow: "Four-way match", title: "Invoice audit",
    actions: `<button class="btn" data-act="audit" data-id="${inv.id}">${findings.length ? "Re-run" : "Run the match"}</button>
      ${open.length ? `<button class="btn" data-act="packet" data-id="${inv.id}">Dispute packet</button>` : ""}`,
    body: `<p class="small muted" style="margin:0 0 12px">
        Every line is checked against the contract the customer accepted, the underlying vendor cost
        or a published benchmark, the shipment's own facts, and the service event record. Findings
        annotate the invoice; they do not block it.</p>

      ${a ? `<div class="grid g4" style="gap:8px;margin-bottom:12px">${SOURCES.map((s) => `
        <div class="tile ${a.summary.depth[s.k] ? "good" : ""}" style="padding:9px 11px">
          <div class="k">${esc(s.label)}</div>
          <div class="v" style="font-size:13px">${a.summary.depth[s.k] ? "Matched" : "No data"}</div>
          <div class="s" style="font-size:10px">${esc(s.sub)}</div></div>`).join("")}</div>` : ""}

      ${a && a.summary.matched < 4 ? `<div class="note warn" style="margin:0 0 12px">
        Matched against ${a.summary.matched} of 4 sources. The lines that depend on the missing ones
        have not been validated — they are listed below rather than passed. Turn the feeds on under
        <a href="#/integrations">External Systems</a> to close the gap.</div>` : ""}

      ${!findings.length ? `<p class="small muted" style="margin:0">
          Not matched yet. Run it <b>before</b> the invoice is paid — carriers and forwarders run
          dispute windows measured in days, and a finding raised at month-end is a finding raised
          after the window closed.</p>`
        : (queryable ? `<p class="small" style="margin:0 0 10px">
            <span class="muted">Queryable on this invoice:</span>
            <b style="color:var(--warning)">${money(queryable, inv.currency)}</b></p>` : "")
          + findings.map((f) => `<div class="finding">
            <div class="row" style="gap:7px">
              ${tag(f.sev, f.sev === "CRITICAL" ? "bad" : f.sev === "WARN" ? "warn" : "", true)}
              <span class="mono muted" style="font-size:10.5px">${esc(f.code)}</span>
              ${tag(f.status, f.status === "DISPUTED" ? "bad" : f.status === "RESOLVED" ? "good" : f.status === "ACCEPTED" ? "" : "warn")}
              ${f.variance ? `<span class="tab" style="margin-left:auto;font-weight:600;color:${f.variance > 0 ? "var(--warning)" : "var(--t2)"}">
                ${f.variance > 0 ? "+" : ""}${money(f.variance, inv.currency)}</span>` : ""}
            </div>
            <p class="msg">${esc(f.msg)}</p>
            ${f.status === "OPEN" ? `<div class="row" style="margin-top:8px">
              <button class="btn sm" data-act="dispute" data-id="${f.id}">Query this line</button>
              <button class="btn sm ghost" data-act="accept" data-id="${f.id}">Accept as billed</button>
            </div>` : ""}
            ${f.note ? `<p class="small muted" style="margin:6px 0 0">${esc(f.note)}</p>` : ""}
          </div>`).join("")}

      <div id="packetbox"></div>` });
}

ACTIONS.audit = (n) => {
  if (!hasRole(S, "finance")) return toast("bad", "Refused", "Running the match needs the finance role.");
  const res = runAudit(S, n.dataset.id);
  LAST_AUDIT[n.dataset.id] = res;
  const q = res.findings.reduce((a, f) => a + Math.max(0, f.variance || 0), 0);
  if (!res.findings.length) toast("good", "No exceptions",
    `${res.summary.linesChecked} line(s) matched against ${res.summary.matched} of 4 sources.`);
  else toast("info", `${res.findings.length} finding(s)`,
    q ? `${money(q)} of this invoice is queryable, matched against ${res.summary.matched} of 4 sources.`
      : `Matched against ${res.summary.matched} of 4 sources. No net overcharge, but the findings are worth reading.`);
  render();
};

ACTIONS.dispute = (n) => {
  resolveException(S, n.dataset.id, "DISPUTED", "Queried with the vendor");
  toast("warn", "Line queried", "Held back from the balance on the document — flagged, not netted off.");
  render();
};
ACTIONS.accept = (n) => {
  resolveException(S, n.dataset.id, "ACCEPTED", `Accepted by ${currentUser(S).name}`);
  toast("info", "Accepted as billed", "Recorded against your name and kept through the next re-run.");
  render();
};

ACTIONS.packet = (n) => {
  const inv = S.invoices.find((x) => x.id === n.dataset.id);
  const s = shipmentOf(inv.shipmentId);
  const findings = S.invoiceExceptions.filter((x) => x.invoiceId === inv.id
    && (x.status === "OPEN" || x.status === "DISPUTED"))
    .map((x) => ({ sev: x.sev, code: x.code, chargeId: x.chargeId, variance: x.variance, msg: x.msg }));
  const elapsed = Math.floor((S.now - inv.createdAt) / DAY);
  const p = disputePacket({
    number: inv.number, issuer: inv.issuer.tradingName || inv.issuer.legalName,
    shipmentRef: s ? s.reference : null, blNumber: inv.blNumber, currency: inv.currency,
    findings, lineById: new Map(invoiceLines(S, inv.id).map((c) => [c.id, c])),
    windowDays: Math.max(0, 14 - elapsed), now: S.now,
  });
  $("#packetbox").innerHTML = `<div style="margin-top:14px">
    <div class="eyebrow mute" style="margin-bottom:6px">Ready to send</div>
    <pre class="mono" style="margin:0;white-space:pre-wrap;font-size:11px;line-height:1.6;color:var(--t2);
      border:1px solid var(--hairline);background:var(--inset);border-radius:4px;padding:12px">${esc(p.body)}</pre></div>`;
  toast("good", "Dispute packet ready",
    p.count ? `${p.count} item(s), ${money(p.claimedCents, inv.currency)}.` : "Nothing quantified to claim.");
};

/* ---------------------------------------------------- audit, portfolio -- */

route(/^\/billing\/exceptions$/, () => {
  const rows = S.invoiceExceptions.filter((e) => e.tenantId === tenantOf(S));
  const open = rows.filter((e) => e.status === "OPEN" || e.status === "DISPUTED");
  const critical = open.filter((e) => e.sev === "CRITICAL");
  const queryable = open.reduce((a, e) => a + Math.max(0, e.variance || 0), 0);

  const byCode = new Map();
  for (const e of open) {
    const p = byCode.get(e.code) || { n: 0, cents: 0, sev: e.sev };
    byCode.set(e.code, { n: p.n + 1, cents: p.cents + Math.max(0, e.variance || 0),
      sev: e.sev === "CRITICAL" ? "CRITICAL" : p.sev });
  }
  const patterns = [...byCode.entries()].sort((a, b) => b[1].cents - a[1].cents || b[1].n - a[1].n);
  const boxes = visibleShipments(S).reduce((a, s) => a + s.containers.length, 0) || 1;

  return head({ eyebrow: "Finance", title: "Invoice exceptions",
    lede: "Findings from the four-way match across every invoice on the book. Raised before payment, because a dispute filed after the window closes is a write-off however good the evidence." })

  + `<div class="grid g4" style="margin-bottom:16px">
      ${tile("Open findings", String(open.length), { tone: open.length ? "warn" : "good" })}
      ${tile("Critical", String(critical.length), { tone: critical.length ? "bad" : "good" })}
      ${tile("Queryable", money(queryable), { tone: queryable ? "warn" : "good" })}
      ${tile("Rules firing", String(patterns.length))}
    </div>`

  + (patterns.length ? `<div class="grid g-53" style="margin-bottom:16px">
      ${panel({ eyebrow: "Portfolio view", title: "Patterns", body:
        patterns.map(([code, p]) => `<div class="row" style="gap:10px;padding:7px 0;border-bottom:1px solid var(--hairline)">
          ${tag(p.sev, p.sev === "CRITICAL" ? "bad" : "warn", true)}
          <span class="mono p" style="font-size:11px">${esc(code)}</span>
          <span class="small muted">on ${p.n} invoice${p.n === 1 ? "" : "s"}</span>
          ${p.cents ? `<span class="tab" style="margin-left:auto;font-weight:600;color:var(--warning)">${money(p.cents)}</span>` : ""}
        </div>`).join("")
        + `<p class="small muted" style="margin:11px 0 0">
            The same rule firing on several invoices is a systematic billing pattern, not several
            coincidences — and it is a conversation with the vendor rather than several separate
            queries.</p>` })}

      ${panel({ eyebrow: "Scale", title: "What this is worth", body:
        kv("Queryable across the book", money(queryable))
        + kv("Containers moved", num(boxes))
        + kv("Per container", money(Math.round(queryable / boxes)))
        + kv("At 3,000 containers a year", `<span class="accent">${money(Math.round(queryable / boxes) * 3000)}</span>`, "tot")
        + `<p class="small muted" style="margin:11px 0 0">
            Every finding here is individually below a manual review threshold, which is exactly why
            they survive. Systematic billing errors run 1.5–2.5% of total forwarder spend, and they
            are invisible from invoice-level review.</p>` })}
    </div>` : "")

  + panel({ eyebrow: "Newest first", title: "All findings", flush: true, body: table(
      [{ label: "Invoice" }, { label: "Rule" }, { label: "Severity" }, { label: "Status" },
       { label: "Variance", align: "r" }, { label: "Finding" }, { label: "Found" }],
      rows.slice().reverse().map((e) => { const inv = S.invoices.find((i) => i.id === e.invoiceId);
        return `<tr class="rowlink" data-go="/invoices/${e.invoiceId}">
          <td><span class="mono" style="color:var(--accent-strong)">${esc(inv ? inv.number : "—")}</span></td>
          <td><span class="mono small">${esc(e.code)}</span></td>
          <td>${tag(e.sev, e.sev === "CRITICAL" ? "bad" : e.sev === "WARN" ? "warn" : "", true)}</td>
          <td>${tag(e.status, e.status === "DISPUTED" ? "bad" : e.status === "RESOLVED" ? "good" : e.status === "ACCEPTED" ? "" : "warn")}</td>
          <td class="r tab" style="${(e.variance || 0) > 0 ? "color:var(--warning)" : ""}">${e.variance == null ? "—" : money(e.variance)}</td>
          <td class="small" style="max-width:400px">${esc(e.msg)}</td>
          <td class="muted small">${ago(e.detectedAt, S.now)}</td></tr>`; }),
      { emptyTitle: "Nothing found yet", emptyBody: "Open an invoice and run the audit. Findings from every invoice collect here." }) });
});

/* --------------------------------------------------- billing settings --- */

route(/^\/billing\/settings$/, () => {
  const p = S.billingProfiles[tenantOf(S)];
  const c = profileCompleteness(p);
  const f = (k, label, hint, type = "text") => `<label class="field">
    <span>${esc(label)}</span>
    <input class="ctl ${type === "mono" ? "mono" : ""}" ${type === "number" ? 'type="number"' : ""}
      value="${esc(p[k] == null ? "" : p[k])}" data-live="profile" data-k="${k}">
    ${hint ? `<span class="small muted">${hint}</span>` : ""}</label>`;

  const byCat = {};
  for (const d of CHARGE_CODES) (byCat[d.cat] = byCat[d.cat] || []).push(d);

  return head({ eyebrow: "Finance", title: "Billing settings",
    lede: "Your company's invoice identity, numbering and charge vocabulary. Every invoice you issue carries these details, and no other company on the platform shares them." })

  + (c.ready ? "" : `<div class="note warn" style="margin-top:0">
      <b>Invoices issued now will be incomplete.</b> Missing: ${esc(c.missing.join("; "))}.
      They will still issue — a forwarder mid-onboarding has to be able to bill today — and the
      document says on its face what is absent rather than printing somebody else's details.</div>`)

  + `<div class="stack" style="margin-bottom:16px">
      ${panel({ eyebrow: "Who is billing", title: "Company", body: `<div class="form-grid">
        ${f("legalName", "Registered legal name")}
        ${f("tradingName", "Trading name", "Printed as the masthead if set")}
        ${f("registrationNumber", "Company registration number")}
        ${f("vatNumber", "VAT registration number", "Without it, invoices issue without VAT and the audit stops checking VAT treatment")}
        ${f("customsClientNumber", "Customs client number", "The SARS CCN this company trades under — required to lodge declarations, and printed so the customer's broker can reconcile the entry", "mono")}
        ${f("email", "Billing email")}
        ${f("phone", "Phone")}
        <label class="field" style="grid-column:1/-1"><span>Registered address</span>
          <textarea class="ctl" rows="3" data-live="profile" data-k="addressLines">${esc(p.addressLines || "")}</textarea></label>
      </div>` })}

      ${panel({ eyebrow: "Where the money goes", title: "Bank details", body: `<div class="form-grid">
        ${f("bankName", "Bank")}
        ${f("bankAccountName", "Account name")}
        ${f("bankAccountNumber", "Account number", "", "mono")}
        ${f("bankBranchCode", "Branch code", "", "mono")}
        ${f("bankSwift", "SWIFT / BIC", "Needed for any customer paying from outside the country", "mono")}
      </div>` })}

      ${panel({ eyebrow: "How invoices are issued", title: "Numbering and terms", body: `<div class="form-grid">
        ${f("invoiceNumberPrefix", "Number prefix", `Next: <span class="mono">${esc(p.invoiceNumberPrefix)}-2026-${String(p.nextInvoiceNumber).padStart(6, "0")}</span>`, "mono")}
        ${f("defaultPaymentTermsDays", "Default payment terms (days)", "", "number")}
        ${f("defaultCurrency", "Default currency", "", "mono")}
        <label class="field"><span>VAT rate (%)</span>
          <input class="ctl tab" type="number" step="0.01" value="${(p.vatBps / 100).toFixed(2)}" data-live="vatpct">
          <span class="small muted">Applied to taxable lines. Duties and import VAT recovered at cost stay zero-rated regardless.</span></label>
        <label class="field" style="grid-column:1/-1"><span>Invoice footer</span>
          <textarea class="ctl" rows="2" data-live="profile" data-k="invoiceFooter">${esc(p.invoiceFooter || "")}</textarea></label>
      </div>` })}
    </div>

    ${panel({ eyebrow: "Standard taxonomy", title: "Charge codes",
      actions: `<span class="small muted">${CHARGE_CODES.length} codes across ${CAT_ORDER.length} categories</span>`,
      body: `<p class="small muted" style="margin:0 0 14px">
        One vendor writes &ldquo;OHC&rdquo;, the next &ldquo;origin handling&rdquo;, a third bundles
        it into the freight charge. Every spelling collapses onto one of these codes before anything
        is compared, priced or analysed. Codes marked ${tag("HIGH", "bad")} carry the highest
        documented billing error rates: they get the least scrutiny from accounts payable and leave
        the most discretion to whoever raised the line.</p>`
      + CAT_ORDER.filter((cat) => byCat[cat]).map((cat) => `
        <div class="eyebrow mute" style="margin:14px 0 5px">${esc(CAT_LABEL[cat])}</div>
        ${table([{ label: "Code" }, { label: "Charge" }, { label: "Billed per" }, { label: "Normally" },
          { label: "VAT" }, { label: "Error rate" }],
          byCat[cat].map((d) => `<tr>
            <td><span class="mono p">${esc(d.code)}</span></td>
            <td class="p">${esc(d.label)}${d.note ? `<div class="small muted" style="margin-top:2px">${esc(d.note)}</div>` : ""}</td>
            <td class="muted">${esc(BASIS_LABEL[d.basis])}</td>
            <td class="muted">${esc(PROV_LABEL[d.prov])}</td>
            <td class="muted">${d.tax ? "Taxable" : "Outside scope"}</td>
            <td>${tag(d.err, d.err === "HIGH" ? "bad" : d.err === "MEDIUM" ? "warn" : "")}</td></tr>`))}`).join("") })}`;
});

LIVE.profile = (n) => {
  const p = S.billingProfiles[tenantOf(S)];
  const k = n.dataset.k;
  p[k] = k === "defaultPaymentTermsDays" ? Number(n.value) : (n.value || null);
  if (k === "invoiceNumberPrefix") p[k] = (n.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (k === "legalName" && !n.value) p[k] = "Unnamed company";
};
LIVE.vatpct = (n) => { S.billingProfiles[tenantOf(S)].vatBps = Math.round(Number(n.value || 0) * 100); };

/* ================================================================ finance */

route(/^\/finance$/, () => {
  const invs = S.invoices.filter((i) => i.tenantId === tenantOf(S));
  const duty = S.charges.filter((c) => c.tenantId === tenantOf(S) && c.code === "DTY");
  const dutyTotal = duty.reduce((a, c) => a + c.sellCents, 0);
  const receivables = invs.filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
  const ageBucket = (i) => {
    const d = Math.floor((S.now - i.createdAt) / DAY);
    return d <= 30 ? "0–30" : d <= 60 ? "31–60" : d <= 90 ? "61–90" : "90+";
  };
  const buckets = { "0–30": 0, "31–60": 0, "61–90": 0, "90+": 0 };
  for (const i of receivables) buckets[ageBucket(i)] += Math.max(0, outstanding(i));
  const maxB = Math.max(1, ...Object.values(buckets));

  return head({ eyebrow: "Finance", title: "What the ledger unlocks",
    lede: "Financial events are mapped through an ontology bridge into a ledger feed. Duty outlay and receivables become financeable positions the day they are recorded — a second product sitting on data the first one produces for free." })

  + `<div class="grid g4" style="margin-bottom:16px">
      ${tile("Duty outlay, financeable", money(dutyTotal), { tone: "accent", sub: `${duty.length} disbursement(s) at cost` })}
      ${tile("Receivables", money(receivables.reduce((a, i) => a + Math.max(0, outstanding(i)), 0)), { sub: `${receivables.length} on the clock` })}
      ${tile("Settled this book", money(S.payments.filter((p) => p.tenantId === tenantOf(S)).reduce((a, p) => a + p.amountCents, 0)), { tone: "good" })}
      ${tile("Ledger events", String(S.events.filter((e) => e.tenantId === tenantOf(S) && /charge|invoice|payment|entry/.test(e.type)).length))}
    </div>

    <div class="grid g-53">
      ${panel({ eyebrow: "Ageing", title: "Receivables on the factoring clock", body:
        Object.entries(buckets).map(([b, v]) => `<div style="margin-bottom:10px">
          <div class="row" style="justify-content:space-between;font-size:12px">
            <span>${esc(b)} days</span><span class="mono">${money(v)}</span></div>
          <div class="meter" style="margin-top:4px"><i style="width:${(v / maxB) * 100}%"></i></div>
        </div>`).join("")
        + `<p class="small muted" style="margin:10px 0 0">
            A receivable becomes financeable the moment it is recognised, not when somebody
            remembers to export a spreadsheet. The clock starts at invoice.issued.</p>` })}

      ${panel({ eyebrow: "Duty financing", title: "Money advanced to SARS", flush: true, body:
        table([{ label: "Shipment" }, { label: "Advanced", align: "r" }, { label: "Recorded" }],
          duty.map((c) => { const s = shipmentOf(c.shipmentId); return `<tr>
            <td><a href="#/shipments/${c.shipmentId}" class="mono small">${esc(s ? s.reference : "—")}</a></td>
            <td class="r tab p">${money(c.sellCents, c.currency)}</td>
            <td class="muted small">${day(c.createdAt)}</td></tr>`; }),
          { emptyTitle: "Nothing advanced", emptyBody: "Duty accrues when a customs entry is released." }) })}
    </div>`;
});

/* ========================================================= platform fees */

route(/^\/platform-fees$/, () => {
  const fees = S.charges.filter((c) => c.tenantId === tenantOf(S) && c.code === "PLF");
  const total = fees.reduce((a, c) => a + c.sellCents, 0);
  const t = S.tenants.find((x) => x.id === tenantOf(S));
  return head({ eyebrow: "Finance", title: "Platform fees",
    lede: `What this company owes the operator for running its book on these rails — ${pct(t.platformFeeBps || 0)} of freight sell, accrued at departure.` })
  + `<div class="grid g4" style="margin-bottom:16px">
      ${tile("Fees accrued", money(total), { tone: "rails" })}
      ${tile("Rate", pct(t.platformFeeBps || 0))}
      ${tile("Shipments", String(visibleShipments(S).length))}
    </div>`
  + panel({ flush: true, body: table([{ label: "Shipment" }, { label: "Basis" }, { label: "Fee", align: "r" }, { label: "Accrued" }],
      fees.map((c) => { const s = shipmentOf(c.shipmentId); return `<tr>
        <td><a href="#/shipments/${c.shipmentId}" class="mono small">${esc(s ? s.reference : "—")}</a></td>
        <td class="muted">${esc(c.description)}</td>
        <td class="r tab p">${money(c.sellCents, c.currency)}</td>
        <td class="muted small">${day(c.createdAt)}</td></tr>`; }),
      { emptyTitle: "No fees yet", emptyBody: "Fees accrue when a shipment departs." }) });
});

/* =============================================================== partners */

route(/^\/partners$/, () => {
  const partners = S.tenants.filter((t) => t.type === "PARTNER_AGENT");
  return head({ eyebrow: "Infrastructure", title: "Other forwarders on these rails",
    lede: "The second business: other forwarders running their own book, their own branding, their own customers — and a platform fee on every shipment they move. Their freight never appears in your list, and yours never appears in theirs." })
  + panel({ flush: true, body: table(
      [{ label: "Partner" }, { label: "Fee rate", align: "r" }, { label: "Shipments", align: "r" },
       { label: "Fees accrued", align: "r" }, { label: "Billing profile" }],
      partners.map((t) => {
        const ships = S.shipments.filter((s) => s.tenantId === t.id);
        const fees = S.charges.filter((c) => c.tenantId === t.id && c.code === "PLF").reduce((a, c) => a + c.sellCents, 0);
        const c = profileCompleteness(S.billingProfiles[t.id]);
        return `<tr>
          <td class="p">${esc(t.name)}</td>
          <td class="r tab">${pct(t.platformFeeBps || 0)}</td>
          <td class="r tab">${ships.length}</td>
          <td class="r tab p" style="color:var(--rails)">${money(fees)}</td>
          <td>${c.ready ? tag("Complete", "good", true) : tag(`${c.missing.length} field(s) missing`, "warn", true)}</td></tr>`;
      })) })
  + `<div class="note rails" style="margin-top:16px">
      <b>A partner's data is not yours.</b> Everything above is a count and a fee — the operator can
      see what it is owed, and nothing about the partner's customers, rates or margins. That is a
      tenant predicate on every query, not a screen that omits a column.</div>`;
});

/* ========================================================= system monitor */

route(/^\/system$/, () => {
  const evts = S.events;
  const byType = {};
  for (const e of evts) byType[e.type] = (byType[e.type] || 0) + 1;
  const top = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxT = Math.max(1, ...top.map((t) => t[1]));
  const consumers = [
    { name: "lifecycle-projector", lag: 0 }, { name: "billing-accrual", lag: 0 },
    { name: "ledger-sink", lag: 0 }, { name: "workflow-signaler", lag: 0 },
    { name: "notification-dispatcher", lag: evts.filter((e) => /gated|departed|arrived|pod/.test(e.type)).length },
  ];

  return head({ eyebrow: "Overview", title: "System monitor",
    lede: "The event log is the source of truth; everything else on this platform is a projection of it. If a consumer falls behind, the screens it feeds fall behind with it — visibly." })
  + `<div class="grid g4" style="margin-bottom:16px">
      ${tile("Events recorded", num(evts.length))}
      ${tile("Relayed to the bus", num(evts.filter((e) => e.published).length), { tone: "good" })}
      ${tile("Unpublished backlog", "0", { tone: "good", sub: "Transactional outbox is drained" })}
      ${tile("Consumers", String(consumers.length))}
    </div>

    <div class="grid g-53">
      ${panel({ eyebrow: "Throughput", title: "Event types", body:
        top.map(([t, n]) => `<div style="margin-bottom:9px">
          <div class="row" style="justify-content:space-between;font-size:11.5px">
            <span class="mono">${esc(t)}</span><span class="muted tab">${n}</span></div>
          <div class="meter" style="margin-top:4px"><i style="width:${(n / maxT) * 100}%"></i></div>
        </div>`).join("") })}

      ${panel({ eyebrow: "Consumers", title: "Offsets", body:
        consumers.map((c) => `<div class="kv"><span class="k mono" style="font-size:11.5px">${esc(c.name)}</span>
          <span class="v">${c.lag === 0 ? tag("caught up", "good", true) : tag(`${c.lag} behind`, "warn", true)}</span></div>`).join("")
        + `<p class="small muted" style="margin:11px 0 0">
            The notification dispatcher runs behind by design: Novu is not configured, so milestone
            notifications are logged and skipped rather than blocking the pipeline behind them.</p>` })}
    </div>

    <div style="height:16px"></div>
    ${panel({ eyebrow: "Append-only", title: "Live event stream", flush: true, body:
      `<div style="padding:2px 16px 14px;max-height:420px;overflow-y:auto">`
      + evts.slice().reverse().slice(0, 60).map((e) => `<div class="evt">
          <span class="ts mono">${stamp(e.occurredAt)}</span>
          <span class="ty mono">${esc(e.type)}</span>
          <span class="pl">${esc(e.src)} · ${esc(Object.entries(e.payload).slice(0, 3).map(([k, v]) => `${k}=${v}`).join("  ") || "—")}</span>
        </div>`).join("") + `</div>` })}`;
});

/* ================================================================= portal */

route(/^\/track$/, () => {
  const ships = visibleShipments(S);
  return head({ eyebrow: "Your cargo", title: "My shipments",
    lede: "The same database and the same events the forwarder sees — a scoping rule and a vocabulary apart. Cost build-up is withheld: the forwarder's margin is its own business." })
  + panel({ flush: true, body: table(
      [{ label: "Reference" }, { label: "From" }, { label: "To" }, { label: "Status" }, { label: "ETA" }],
      ships.map((s) => `<tr class="rowlink" data-go="/track/${s.id}">
        <td><span class="mono" style="color:var(--accent-strong)">${esc(s.reference)}</span></td>
        <td class="p">${esc(PORTS[s.origin] || s.origin)}</td>
        <td class="p">${esc(PORTS[s.destination] || s.destination)}</td>
        <td>${statusTag(s.status)}</td>
        <td class="mono" style="font-size:11px">${day(s.eta)}</td></tr>`),
      { emptyTitle: "Nothing here yet", emptyBody: "Shipments appear once your forwarder links your company to a booking party." }) });
});

route(/^\/track\/invoices$/, () => {
  const scope = customerScope(S, tenantOf(S));
  const invs = S.invoices.filter((i) => scope.includes(i.customerId));
  return head({ eyebrow: "Your account", title: "My invoices",
    lede: "Your own invoices, exactly as issued — every reference your accounts-payable team matches on, and no sign of what any of it cost the forwarder." })
  + panel({ flush: true, body: table(
      [{ label: "Number" }, { label: "Shipment" }, { label: "Total", align: "r" },
       { label: "Outstanding", align: "r" }, { label: "Due" }, { label: "Status" }],
      invs.map((i) => { const s = shipmentOf(i.shipmentId); return `<tr class="rowlink" data-go="/track/inv/${i.id}">
        <td><span class="mono" style="color:var(--accent-strong)">${esc(i.number)}</span></td>
        <td><span class="mono small">${esc(s ? s.reference : "—")}</span></td>
        <td class="r tab p">${money(i.totalCents, i.currency)}</td>
        <td class="r tab">${money(Math.max(0, outstanding(i)), i.currency)}</td>
        <td class="mono" style="font-size:11px">${day(i.dueDate)}</td>
        <td>${invTag(i.status)}</td></tr>`; }),
      { emptyTitle: "No invoices yet", emptyBody: "" }) });
});

/* The customer's own copy of the document. Costs and margin are absent because
   the assembler was never given them, not because a column is hidden. */
route(/^\/track\/inv\/(.+)$/, (id) => {
  const inv = S.invoices.find((x) => x.id === id);
  const scope = customerScope(S, tenantOf(S));
  if (!inv || !scope.includes(inv.customerId)) return empty("Not found", "This invoice isn't one of yours.");
  const doc = buildDocument(inv, invoiceLines(S, inv.id), { commercial: false });
  const paid = paidOn(S, inv.id);
  const s = shipmentOf(inv.shipmentId);

  return head({ eyebrow: "Your account", title: inv.number, lede: `From ${esc(inv.issuer.tradingName || inv.issuer.legalName)}` })
  + `<div style="margin-bottom:12px">${back("/track/invoices", "My invoices")}</div>
    <article class="doc">
      <div class="doc-head">
        <div><div class="doc-issuer">${esc(inv.issuer.tradingName || inv.issuer.legalName)}</div>
          <div class="small muted" style="margin-top:6px;white-space:pre-line">${esc(inv.issuer.addressLines || "")}</div>
          <div class="small muted" style="margin-top:6px">VAT <span class="mono">${esc(inv.issuer.vatNumber || "—")}</span></div></div>
        <div style="text-align:right"><div class="eyebrow">Freight invoice</div>
          <div class="doc-num">${esc(inv.number)}</div>
          <div class="small muted" style="margin-top:7px">Due ${day(inv.dueDate)}<br>
            ${s ? `Shipment <span class="mono">${esc(s.reference)}</span>` : ""}</div></div>
      </div>
      <div class="scroll-x" style="margin-top:16px"><table class="tbl">
        <thead><tr><th>Charge</th><th class="r">Qty</th><th class="r">Amount</th><th class="r">VAT</th></tr></thead>
        <tbody>${doc.sections.map((sec) => `
          <tr><td colspan="4" class="eyebrow mute" style="padding-top:11px">${esc(sec.label)}</td></tr>
          ${sec.lines.map((l) => `<tr>
            <td class="p">${esc(l.description)} <span>${tag(PROV_LABEL[l.prov], PROV_TAG[l.prov])}</span></td>
            <td class="r tab">${l.qty}</td>
            <td class="r tab p">${money(l.sellCents, l.currency)}</td>
            <td class="r tab muted">${l.vatBps ? money(l.vatCents, inv.currency) : "Zero-rated"}</td></tr>`).join("")}`).join("")}
        </tbody></table></div>
      <div class="two-col" style="margin-top:16px"><div>
        <div class="eyebrow mute" style="margin-bottom:7px">How this invoice is made up</div>
        ${kv("Recovered at cost", money(doc.totals.passThrough, inv.currency))}
        ${kv("Third-party services", money(doc.totals.markedUp, inv.currency))}
        ${kv("Forwarder's own services", money(doc.totals.own, inv.currency))}
      </div><div>
        ${kv("Subtotal", money(doc.totals.sub, inv.currency))}
        ${kv("VAT", money(doc.totals.vat, inv.currency))}
        ${kv("Total", `<span class="accent">${money(doc.totals.total, inv.currency)}</span>`, "tot")}
        ${paid ? kv("Paid", "− " + money(paid, inv.currency)) : ""}
        ${paid ? kv("Balance", money(inv.totalCents - paid, inv.currency), "tot") : ""}
      </div></div>
      <div class="doc-notice">${esc(DOC_NOTICE)}</div>
    </article>`;
});

route(/^\/track\/(.+)$/, (id) => {
  const s = shipmentOf(id);
  const scope = customerScope(S, tenantOf(S));
  if (!s || !scope.includes(s.customerId)) return empty("Not found", "This shipment either doesn't exist or isn't one of yours.");
  const cons = S.consignments.find((c) => c.id === s.consignmentId);
  /* Milestones in a shipper's words, and only the ones they have a stake in.
     Charge and quote events are dropped at the API, not hidden in the view. */
  const milestones = S.events.filter((e) => e.shipmentId === s.id)
    .map((e) => ({ e, m: LIFECYCLE.find((l) => l.type === e.type) }))
    .filter((x) => x.m);

  return head({ eyebrow: "Your cargo", title: s.reference,
    lede: `${esc(PORTS[s.origin] || s.origin)} → ${esc(PORTS[s.destination] || s.destination)}` })
  + `<div style="margin-bottom:12px">${back("/track", "My shipments")}</div>
    <div class="row" style="margin-bottom:14px">${statusTag(s.status)}
      <span class="small muted">Booked ${day(s.createdAt)} · expected ${day(s.eta)}</span></div>
    <div class="grid g-53">
      <div class="stack">${cons ? cargoPanel(cons, false) : ""}</div>
      ${panel({ eyebrow: "What has happened so far", title: "Journey", body:
        `<div class="tl">` + milestones.map((x, i) => `<div class="tl-step done">
          <div class="tl-rail"><span class="tl-dot"></span>${i < milestones.length - 1 ? `<span class="tl-line"></span>` : ""}</div>
          <div class="tl-body"><div class="tl-t">${esc(x.m.customer)}</div>
          <div class="tl-m">${stamp(x.e.occurredAt)}</div></div></div>`).join("") + `</div>` })}
    </div>`;
});
