/* ==========================================================================
 * SCREENS
 * ======================================================================== */

const statusTag = (s) => tag(s.replace(/_/g, " "), STATUS_TONE[s] ?? "", true);
const invTag = (s) => tag(s.replace(/_/g, " "), INV_TONE[s] ?? "", true);
const partyName = (id) => (S.parties.find((p) => p.id === id) || {}).name || "—";
const shipmentOf = (id) => S.shipments.find((s) => s.id === id);
const lane = (s) => `${s.origin} → ${s.destination}`;
const outstanding = (inv) => inv.totalCents - paidOn(S, inv.id);

/* ============================================================= dashboard */

route(/^\/$/, () => {
  const ships = visibleShipments(S);
  const active = ships.filter((s) => s.status !== "DELIVERED" && s.status !== "CANCELLED");
  const invs = S.invoices.filter((i) => i.tenantId === tenantOf(S));
  const owed = invs.filter((i) => i.status !== "PAID" && i.status !== "CANCELLED")
    .reduce((a, i) => a + Math.max(0, outstanding(i)), 0);
  const overdue = invs.filter((i) => i.status === "OVERDUE");
  const exceptions = openExceptions();
  const findings = openFindings();
  const queryable = findings.reduce((a, f) => a + Math.max(0, f.variance || 0), 0);

  const margin = S.charges.filter((c) => c.tenantId === tenantOf(S) && c.buyCents != null)
    .reduce((a, c) => ({ sell: a.sell + c.sellCents, buy: a.buy + c.buyCents }), { sell: 0, buy: 0 });

  const byLane = {};
  for (const s of ships) byLane[lane(s)] = (byLane[lane(s)] || 0) + 1;
  const lanes = Object.entries(byLane).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxLane = Math.max(1, ...lanes.map((l) => l[1]));

  const recent = S.events.filter((e) => e.tenantId === tenantOf(S)).slice(-9).reverse();

  return head({ eyebrow: "Overview", title: "The book, on one screen",
    lede: "Every shipment on the water, every exception a human has to touch, and what is actually owed — read from the same event log the customer's tracking page reads." })
  + `<div class="grid g4" style="margin-bottom:16px">
      ${tile("Active shipments", String(active.length), { sub: `${ships.length} in the book` })}
      ${tile("Open exceptions", String(exceptions.length), { tone: exceptions.length ? "bad" : "good", sub: exceptions.length ? "Needing a decision today" : "Nothing blocked" })}
      ${tile("Owed", money(owed), { tone: owed ? "warn" : "good", sub: `${overdue.length} invoice(s) overdue` })}
      ${tile("Queryable on invoices", money(queryable), { tone: queryable ? "warn" : "good", sub: `${findings.length} open audit finding(s)` })}
    </div>

    <div class="grid g-53" style="margin-bottom:16px">
      ${panel({ eyebrow: "In motion", title: "Shipments", flush: true,
        actions: `<a class="btn sm" href="#/shipments">Open the list</a>`,
        body: table([{ label: "Reference" }, { label: "Lane" }, { label: "Customer" }, { label: "Status" }, { label: "ETA" }],
          ships.slice(0, 7).map((s) => `<tr class="rowlink" data-go="/shipments/${s.id}">
            <td><span class="mono" style="color:var(--accent-strong)">${esc(s.reference)}</span></td>
            <td class="p">${esc(lane(s))}</td>
            <td>${esc(partyName(s.customerId))}</td>
            <td>${statusTag(s.status)}</td>
            <td class="mono" style="font-size:11px">${day(s.eta)}</td></tr>`)) })}

      <div class="stack">
        ${panel({ eyebrow: "This tenant", title: "Margin realised", body:
          kv("Sell billed", money(margin.sell))
          + kv("Buy incurred", money(margin.buy))
          + kv("Gross margin", `<span class="accent">${money(margin.sell - margin.buy)}</span>`, "tot")
          + `<div class="meter" style="margin-top:11px"><i style="width:${margin.sell ? Math.min(100, ((margin.sell - margin.buy) / margin.sell) * 100).toFixed(1) : 0}%"></i></div>
             <p class="small muted" style="margin:7px 0 0">
               ${margin.sell ? (((margin.sell - margin.buy) / margin.sell) * 100).toFixed(1) : "0.0"}% on lines with a recorded cost.
               Duty and VAT are billed at cost and remitted, so they carry no margin and do not flatter this number.</p>` })}

        ${panel({ eyebrow: "Corridor mix", title: "Where the freight goes", body:
          lanes.map(([l, n]) => `<div style="margin-bottom:9px">
            <div class="row" style="justify-content:space-between;font-size:11.5px">
              <span class="mono">${esc(l)}</span><span class="muted">${n}</span></div>
            <div class="meter" style="margin-top:4px"><i style="width:${(n / maxLane) * 100}%"></i></div>
          </div>`).join("") || empty("No lanes yet", "Book something.") })}
      </div>
    </div>

    ${panel({ eyebrow: "Append-only", title: "Latest events", flush: true, body:
      `<div style="padding:4px 16px 14px">` + recent.map((e) => `<div class="evt">
        <span class="ts mono">${stamp(e.occurredAt)}</span>
        <span class="ty mono">${esc(e.type)}</span>
        <span class="pl">${esc(Object.entries(e.payload).slice(0, 3).map(([k, v]) => `${k}=${v}`).join("  ") || "—")}</span>
      </div>`).join("") + `</div>` })}`;
});

/* ================================================================= quote */

const QF = {
  customerId: "p-ubuntu", origin: "CNSHA", destination: "ZADUR", mode: "OCEAN",
  eq: "40HC", qty: 2, incoterm: "CIF",
  description: "Cotton knitted T-shirts, printed, for retail distribution",
  cargoType: "GENERAL", urgency: "STANDARD",
  pickupLocode: "", pickupAddress: "",
  unNumber: "", imoClass: "", packingGroup: "", tempMin: "", tempMax: "",
  items: [{ description: "Cotton T-shirts", packageType: "CARTON", pieces: 420,
    weightKg: 8400, l: 60, w: 40, h: 40, stackable: true, marks: "UBT/DUR/1-420" }],
  result: null, error: null, quoteId: null,
};

const consignmentDraft = () => ({
  description: QF.description, cargoType: QF.cargoType, urgency: QF.urgency,
  portOfExit: QF.origin, portOfEntry: QF.destination,
  pickupLocode: QF.pickupLocode || null, pickupAddress: QF.pickupAddress || null,
  unNumber: QF.unNumber || null, imoClass: QF.imoClass || null, packingGroup: QF.packingGroup || null,
  tempMinDeciC: QF.tempMin === "" ? null : Math.round(Number(QF.tempMin) * 10),
  tempMaxDeciC: QF.tempMax === "" ? null : Math.round(Number(QF.tempMax) * 10),
  items: QF.items.map((i) => ({
    description: i.description, packageType: i.packageType, pieces: Number(i.pieces) || 0,
    grossWeightGrams: Math.round((Number(i.weightKg) || 0) * 1000),
    lengthMm: i.l ? Math.round(Number(i.l) * 10) : null,
    widthMm: i.w ? Math.round(Number(i.w) * 10) : null,
    heightMm: i.h ? Math.round(Number(i.h) * 10) : null,
    stackable: i.stackable !== false, marksAndNumbers: i.marks || null,
  })),
});

route(/^\/quotes\/new$/, () => {
  const draft = consignmentDraft();
  const m = computeTotals(draft.items, QF.mode);
  const reqs = handlingRequirements(draft);
  const blocking = reqs.filter((r) => r.blocking);
  /* Scoped, like everything else that reads rate cards. Unscoped, the picker
     offered corridors this company has no tariff on — another tenant's lanes,
     visible in a dropdown, priced as "no valid rate card". */
  const lanes = [...new Set(S.rateCards.filter((c) => c.tenantId === tenantOf(S))
    .map((c) => `${c.origin}|${c.destination}|${c.mode}`))];

  const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(label)}</option>`;

  return head({ eyebrow: "Commercial", title: "Price a corridor",
    lede: "The packing list is priced as you type it — nothing is saved until you raise the quote. Chargeable weight, cargo uplift and the service-level transit ceiling all come from what you enter here, so a quote raised without it is a guess." })

  + `<div class="grid g-53">
    <div class="stack">
      ${panel({ eyebrow: "The movement", title: "Lane and equipment", body: `
        <div class="form-grid">
          <label class="field"><span>Customer</span>
            <select class="ctl" data-change="qf" data-k="customerId">
              ${S.parties.filter((p) => p.tenantId === tenantOf(S) && p.taxId)
                .map((p) => opt(p.id, p.name, QF.customerId)).join("")}
            </select></label>
          <label class="field"><span>Lane</span>
            <select class="ctl" data-change="qf" data-k="lane">
              ${lanes.map((l) => { const [o, d, mo] = l.split("|");
                return opt(l, `${o} → ${d} · ${mo}`, `${QF.origin}|${QF.destination}|${QF.mode}`); }).join("")}
            </select></label>
          <label class="field"><span>Equipment</span>
            <select class="ctl" data-change="qf" data-k="eq">
              ${["20GP", "40GP", "40HC", "40RF"].map((e) => opt(e, e, QF.eq)).join("")}
            </select></label>
          <label class="field"><span>Containers</span>
            <input class="ctl tab" type="number" min="1" max="20" value="${QF.qty}" data-change="qf" data-k="qty"></label>
          <label class="field"><span>Incoterm</span>
            <select class="ctl" data-change="qf" data-k="incoterm">
              ${["EXW", "FOB", "CFR", "CIF", "DAP", "DDP"].map((i) => opt(i, i, QF.incoterm)).join("")}
            </select></label>
        </div>` })}

      ${panel({ eyebrow: "What is in the box", title: "Cargo", body: `
        <div class="form-grid" style="margin-bottom:13px">
          <label class="field" style="grid-column:1/-1"><span>Description, as it will read on the B/L</span>
            <input class="ctl" value="${esc(QF.description)}" data-live="qf" data-k="description"></label>
          <label class="field"><span>Cargo type</span>
            <select class="ctl" data-change="qf" data-k="cargoType">
              ${Object.entries(CARGO_TYPES).map(([k, v]) =>
                opt(k, `${v.label}${v.upliftBps ? ` · +${pct(v.upliftBps)}` : ""}`, QF.cargoType)).join("")}
            </select></label>
          <label class="field"><span>Urgency</span>
            <select class="ctl" data-change="qf" data-k="urgency">
              ${Object.entries(URGENCY).map(([k, v]) =>
                opt(k, `${v.label}${v.maxTransitDays ? ` · ≤${v.maxTransitDays}d` : ""}`, QF.urgency)).join("")}
            </select></label>
          <label class="field"><span>Pick-up LOCODE</span>
            <input class="ctl mono" placeholder="ZAJNB" value="${esc(QF.pickupLocode)}" data-live="qf" data-k="pickupLocode"></label>
          <label class="field" style="grid-column:span 2"><span>Collection address</span>
            <input class="ctl" placeholder="Delivered to port by shipper" value="${esc(QF.pickupAddress)}" data-live="qf" data-k="pickupAddress"></label>
        </div>

        ${QF.cargoType === "HAZARDOUS" ? `<div class="form-grid" style="margin-bottom:13px">
          <label class="field"><span>UN number</span><input class="ctl mono" placeholder="UN1263" value="${esc(QF.unNumber)}" data-live="qf" data-k="unNumber"></label>
          <label class="field"><span>IMO class</span><input class="ctl mono" placeholder="3" value="${esc(QF.imoClass)}" data-live="qf" data-k="imoClass"></label>
          <label class="field"><span>Packing group</span><input class="ctl mono" placeholder="III" value="${esc(QF.packingGroup)}" data-live="qf" data-k="packingGroup"></label>
        </div>` : ""}

        ${QF.cargoType === "REEFER" ? `<div class="form-grid" style="margin-bottom:13px">
          <label class="field"><span>Min °C</span><input class="ctl tab" type="number" step="0.1" value="${esc(QF.tempMin)}" data-live="qf" data-k="tempMin"></label>
          <label class="field"><span>Max °C</span><input class="ctl tab" type="number" step="0.1" value="${esc(QF.tempMax)}" data-live="qf" data-k="tempMax"></label>
        </div>` : ""}

        <div class="eyebrow mute" style="margin-bottom:7px">Packing list — dimensions are per piece, weight is the line total</div>
        <div class="scroll-x"><table class="tbl">
          <thead><tr><th>Contents</th><th>Packaging</th><th class="r">Pieces</th><th class="r">Weight kg</th>
            <th>L × W × H cm</th><th>Marks</th><th></th></tr></thead>
          <tbody>${QF.items.map((it, i) => `<tr>
            <td><input class="ctl" style="min-width:150px" value="${esc(it.description)}" data-live="item" data-i="${i}" data-k="description"></td>
            <td><select class="ctl" data-change="item" data-i="${i}" data-k="packageType">
              ${Object.entries(PACKAGE_TYPES).map(([k, v]) => opt(k, v, it.packageType)).join("")}</select></td>
            <td><input class="ctl tab" style="width:76px" type="number" value="${it.pieces}" data-live="item" data-i="${i}" data-k="pieces"></td>
            <td><input class="ctl tab" style="width:92px" type="number" value="${it.weightKg}" data-live="item" data-i="${i}" data-k="weightKg"></td>
            <td><div class="row" style="gap:4px;flex-wrap:nowrap">
              <input class="ctl tab" style="width:58px" type="number" value="${it.l}" data-live="item" data-i="${i}" data-k="l">
              <input class="ctl tab" style="width:58px" type="number" value="${it.w}" data-live="item" data-i="${i}" data-k="w">
              <input class="ctl tab" style="width:58px" type="number" value="${it.h}" data-live="item" data-i="${i}" data-k="h"></div></td>
            <td><input class="ctl mono" style="min-width:110px" value="${esc(it.marks || "")}" data-live="item" data-i="${i}" data-k="marks"></td>
            <td>${QF.items.length > 1 ? `<button class="btn sm ghost" data-act="delItem" data-i="${i}">Remove</button>` : ""}</td>
          </tr>`).join("")}</tbody></table></div>
        <div class="row" style="margin-top:11px">
          <button class="btn sm" data-act="addItem">Add a line</button>
        </div>` })}
    </div>

    <div class="stack">
      ${panel({ eyebrow: "Measured live", title: "Chargeable weight", body: `
        <div class="grid g2" style="gap:9px">
          ${tile("Pieces", num(m.pieces))}
          ${tile("Gross", kg(m.grossWeightGrams))}
          ${tile("Volume", cbm(m.volumeCm3))}
          ${tile("Chargeable", kg(m.chargeableWeightGrams), { tone: "accent" })}
        </div>
        <p class="small muted" style="margin:11px 0 0">
          ${m.volumetricApplies
            ? `Volume wins. ${cbm(m.volumeCm3)} at ${num(m.divisor)} cm³/kg is deemed
               ${kg(m.volumetricWeightGrams)}, against ${kg(m.grossWeightGrams)} actual — this cargo
               is billed on the space it occupies, not its mass.`
            : `Mass wins. The goods weigh ${kg(m.grossWeightGrams)} against a volumetric
               ${kg(m.volumetricWeightGrams)} at ${num(m.divisor)} cm³/kg, so the carrier bills the weight.`}
        </p>` })}

      ${reqs.length ? panel({ eyebrow: "Handling", title: "What this cargo requires", body:
        reqs.map((r) => `<div class="row" style="align-items:flex-start;gap:9px;margin-bottom:8px">
          ${tag(r.blocking ? "Required" : "Note", r.blocking ? "bad" : "warn", true)}
          <span class="small" style="flex:1;color:var(--t2)">${esc(r.description)}</span></div>`).join("") }) : ""}

      ${panel({ eyebrow: "Price it", title: "Quote", actions:
        `<button class="btn primary" data-act="price" ${blocking.length ? "disabled" : ""}>Raise the quote</button>`,
        body: QF.error
          ? `<div class="note warn" style="margin:0"><b>${esc(QF.error.kind === "NO_SERVICE_LEVEL" ? "No service at that level" : "No rate")}.</b> ${esc(QF.error.message)}</div>`
          : QF.result ? quoteResult() : blocking.length
            ? `<p class="small muted" style="margin:0">${esc(blocking[0].description)}</p>`
            : `<p class="small muted" style="margin:0">Nothing is written until you press it. The engine picks the cheapest valid card on the lane, applies the most specific margin rule, and prices each surcharge on its own basis.</p>` })}
    </div>
  </div>`;
});

function quoteResult() {
  const r = QF.result;
  const marginZar = r.totalZar - r.buyZar;
  return `
    <div class="row" style="margin-bottom:11px">
      ${tag(r.card.carrier, "accent", true)}
      ${tag(`${r.transitDays} day transit`)}
      ${tag(`Margin rule ${r.rule.id} · ${pct(r.rule.marginBps)}`)}
    </div>
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>Code</th><th>Line</th><th class="r">Qty</th><th class="r">Sell</th></tr></thead>
      <tbody>${r.lines.map((l) => `<tr>
        <td><span class="mono" style="font-size:10.5px">${esc(l.code)}</span></td>
        <td class="p">${esc(l.description)}</td>
        <td class="r tab">${l.quantity}</td>
        <td class="r tab p">${money(l.sellCents, l.currency)}</td></tr>`).join("")}</tbody></table></div>
    <div style="margin-top:11px">
      ${Object.entries(r.totalsByCurrency).map(([c, v]) => kv(`Total ${c}`, money(v, c))).join("")}
      ${kv("Total, converted", `<span class="accent">${money(r.totalZar)}</span>`, "tot")}
      ${kv("Margin", money(marginZar) + ` <span class="muted">(${((marginZar / r.totalZar) * 100).toFixed(1)}%)</span>`)}
    </div>
    <div class="row" style="margin-top:12px">
      <input class="ctl mono" style="flex:1;min-width:130px" placeholder="Carrier booking ref" id="bookref">
      <button class="btn primary" data-act="book">Book it</button>
    </div>
    <p class="small muted" style="margin:9px 0 0">
      Booking writes the quote acceptance, the shipment and the first charge accrual in one
      transaction. Either all of it happened or none of it did.</p>`;
}

LIVE.qf = (n) => {
  const k = n.dataset.k;
  if (k === "lane") {
    const [o, d, m] = n.value.split("|");
    QF.origin = o; QF.destination = d; QF.mode = m;
  } else if (k === "qty") QF.qty = Math.max(1, Math.min(20, Number(n.value) || 1));
  else QF[k] = n.value;
  QF.result = null; QF.error = null;
  if (["description", "pickupLocode", "pickupAddress", "unNumber", "imoClass", "packingGroup", "tempMin", "tempMax"].includes(k)) {
    /* Text fields recompute the panel beside them without stealing the caret,
       so only the measured block is repainted. */
    repaintMeasure();
  } else render();
};

LIVE.item = (n) => {
  const it = QF.items[Number(n.dataset.i)];
  const k = n.dataset.k;
  it[k] = ["pieces", "weightKg", "l", "w", "h"].includes(k) ? Number(n.value) : n.value;
  QF.result = null;
  if (n.dataset.change !== undefined) render(); else repaintMeasure();
};

function repaintMeasure() {
  const draft = consignmentDraft();
  const m = computeTotals(draft.items, QF.mode);
  const tiles = $$("#view .tile .v");
  if (tiles.length >= 4) {
    tiles[tiles.length - 4].textContent = num(m.pieces);
    tiles[tiles.length - 3].textContent = kg(m.grossWeightGrams);
    tiles[tiles.length - 2].textContent = cbm(m.volumeCm3);
    tiles[tiles.length - 1].textContent = kg(m.chargeableWeightGrams);
  }
}

ACTIONS.addItem = () => {
  QF.items.push({ description: "", packageType: "CARTON", pieces: 0, weightKg: 0, l: 0, w: 0, h: 0, stackable: true, marks: "" });
  render();
};
ACTIONS.delItem = (n) => { QF.items.splice(Number(n.dataset.i), 1); render(); };

ACTIONS.price = () => {
  QF.error = null;
  try {
    const cons = consignmentDraft();
    const blocking = handlingRequirements(cons).filter((r) => r.blocking);
    if (blocking.length) throw Object.assign(new Error(blocking[0].description), { kind: "BLOCKED" });
    /* The tenant predicate again. Pricing from the screen went through
       buildQuote without it, so selectRateCards filtered on `undefined` and
       every quote raised from the form came back "no valid rate card" — on a
       lane the operator demonstrably had a card for. The seeded book hid it
       because populate() prices through createQuote, which passes it. */
    QF.result = buildQuote(S, {
      tenantId: tenantOf(S),
      customerId: QF.customerId, origin: QF.origin, destination: QF.destination, mode: QF.mode,
      containerType: QF.eq, containerQuantity: QF.qty, incoterm: QF.incoterm,
      consignment: cons, urgency: QF.urgency,
    });
  } catch (e) { QF.error = e; QF.result = null; }
  render();
  if (QF.result) toast("good", "Priced",
    `${QF.result.card.carrier} at ${money(QF.result.totalZar)} — margin rule ${QF.result.rule.id}.`);
  /* "We don't serve that corridor" and "we serve it in 34 days and you asked
     for 10" are different conversations, and answering the second with the
     first loses the sale for the wrong reason. */
  else if (QF.error) toast("warn", QF.error.kind === "NO_SERVICE_LEVEL" ? "No service at that level" : "Cannot price this", QF.error.message);
};

ACTIONS.book = () => {
  if (!QF.result) return;
  if (!hasRole(S, "ops")) return toast("bad", "Refused", "Booking needs the ops role. This session does not carry it.");
  const cons = createConsignment(S, tenantOf(S), consignmentDraft(), QF.mode);
  const q = createQuote(S, tenantOf(S), {
    customerId: QF.customerId, origin: QF.origin, destination: QF.destination, mode: QF.mode,
    containerType: QF.eq, containerQuantity: QF.qty, incoterm: QF.incoterm,
    consignment: cons, urgency: QF.urgency,
  });
  const ref = ($("#bookref") || {}).value || null;
  const s = bookQuote(S, q.id, ref);
  QF.result = null;
  toast("good", `Booked ${s.reference}`, `${lane(s)} · ${s.containers.length} × ${QF.eq}. Charges accrued from the quote.`);
  go(`/shipments/${s.id}`);
};

/* ================================================================= rates */

route(/^\/rates$/, () => {
  /* This company's own buy and sell sides. Pinned to the operator, it showed a
     partner agent somebody else's carrier rates and margins. */
  const cards = S.rateCards.filter((c) => c.tenantId === tenantOf(S));
  const rules = S.marginRules.filter((r) => r.tenantId === tenantOf(S));
  const validity = (c) => {
    if (S.now > c.validTo) return tag("Expired", "bad", true);
    if (c.validTo - S.now < 21 * DAY) return tag(`${Math.ceil((c.validTo - S.now) / DAY)}d left`, "warn", true);
    return tag("Valid", "good", true);
  };

  return head({ eyebrow: "Commercial", title: "Buy rates, and the margin on top",
    lede: "The buy side and the sell side are separate objects on purpose. A rate card is what a lane costs; a margin rule is what this company sells it for. Renegotiating a carrier rate must not silently reprice every customer." })

  + panel({ eyebrow: "Buy side", title: "Rate cards", flush: true, body:
      table([{ label: "Lane" }, { label: "Mode" }, { label: "Carrier" }, { label: "Eq" },
        { label: "Buy", align: "r" }, { label: "Transit", align: "r" }, { label: "Surcharges" }, { label: "Validity" }],
        cards.map((c) => `<tr>
          <td><span class="mono p">${esc(c.origin)} → ${esc(c.destination)}</span></td>
          <td>${esc(c.mode)}</td>
          <td class="p">${esc(c.carrier)}</td>
          <td class="mono">${esc(c.eq)}</td>
          <td class="r tab p">${money(c.buyCents, c.currency)}</td>
          <td class="r tab">${c.transitDays ? c.transitDays + "d" : "—"}</td>
          <td>${c.surcharges.length
            ? c.surcharges.map((s) => `<span class="tag">${esc(s.code)}</span>`).join(" ")
            : `<span class="muted">none</span>`}</td>
          <td>${validity(c)} <span class="muted small">to ${day(c.validTo)}</span></td></tr>`)) })

  + `<div style="height:16px"></div>`

  + panel({ eyebrow: "Sell side", title: "Margin rules", flush: true, body:
      `<div style="padding:0 16px 6px"><p class="small muted" style="margin:0 0 10px">
        The most specific rule wins, and ties break by recency. Without that tiebreak the same
        quote could price at 15% or 18% depending on row order — a difference a customer
        eventually notices.</p></div>`
      + table([{ label: "Scope" }, { label: "Specificity", align: "r" }, { label: "Margin", align: "r" },
        { label: "Floor per line", align: "r" }, { label: "Added" }],
        rules.slice().sort((a, b) => {
          const d = (r) => [r.customerId, r.origin, r.destination, r.mode].filter(Boolean).length;
          return d(b) - d(a) || b.createdAt - a.createdAt;
        }).map((r) => {
          const dims = [r.customerId, r.origin, r.destination, r.mode].filter(Boolean).length;
          const scope = [r.customerId ? partyName(r.customerId) : null,
            r.origin && r.destination ? `${r.origin} → ${r.destination}` : null, r.mode].filter(Boolean).join(" · ");
          return `<tr>
            <td class="p">${esc(scope || "Everything else")}</td>
            <td class="r tab">${dims}</td>
            <td class="r tab p">${pct(r.marginBps)}</td>
            <td class="r tab">${money(r.minMarginCents)}</td>
            <td class="muted">${day(r.createdAt)}</td></tr>`;
        })) })

  + `<div class="note" style="margin-top:16px">
      <b>The floor is converted before it is compared.</b> It is held in ZAR cents; applying it to a
      USD line as though it were dollars turns an 18% margin into 69%. That is not a number any
      shipper accepts, and it is invisible until somebody quotes a cheap lane.</div>`;
});

/* ============================================================= shipments */

let SHIP_FILTER = "ALL";

route(/^\/shipments$/, () => {
  const all = visibleShipments(S);
  const rows = SHIP_FILTER === "ALL" ? all : all.filter((s) => s.status === SHIP_FILTER);
  const counts = (st) => all.filter((s) => s.status === st).length;

  return head({ eyebrow: "Commercial", title: "Shipments",
    lede: "Every movement in this tenant's book. Status is a projection of the event log, not a field anybody edits." })
  + `<div class="row" style="margin-bottom:14px">
      <div class="seg">
        ${["ALL", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"].map((st) =>
          `<button data-act="shipFilter" data-v="${st}" aria-pressed="${SHIP_FILTER === st}">
            ${st === "ALL" ? "All" : st.replace("_", " ").toLowerCase()}
            ${st === "ALL" ? all.length : counts(st)}</button>`).join("")}
      </div>
      <span class="small muted">${rows.length} of ${all.length}</span>
    </div>`
  + panel({ flush: true, body: table(
      [{ label: "Reference" }, { label: "Lane" }, { label: "Customer" }, { label: "Carrier" },
       { label: "Boxes", align: "r" }, { label: "Status" }, { label: "Progress" }, { label: "ETA" }],
      rows.map((s) => `<tr class="rowlink" data-go="/shipments/${s.id}">
        <td><span class="mono" style="color:var(--accent-strong)">${esc(s.reference)}</span></td>
        <td class="p">${esc(lane(s))}</td>
        <td>${esc(partyName(s.customerId))}</td>
        <td>${esc(s.carrier || "—")}</td>
        <td class="r tab">${s.containers.length}</td>
        <td>${statusTag(s.status)}</td>
        <td style="min-width:110px"><div class="meter"><i style="width:${((s.step + 1) / LIFECYCLE.length * 100).toFixed(0)}%"></i></div></td>
        <td class="mono" style="font-size:11px">${day(s.eta)}</td></tr>`),
      { emptyTitle: "No shipments in that state", emptyBody: "Change the filter, or book something new." }) });
});

ACTIONS.shipFilter = (n) => { SHIP_FILTER = n.dataset.v; render(); };

route(/^\/shipments\/(.+)$/, (id) => {
  const s = shipmentOf(id);
  if (!s || s.tenantId !== tenantOf(S)) return empty("Not found", "This shipment either doesn't exist or isn't yours.");
  const cons = S.consignments.find((c) => c.id === s.consignmentId);
  const charges = S.charges.filter((c) => c.shipmentId === s.id);
  const evts = S.events.filter((e) => e.shipmentId === s.id);
  const entry = entryFor(S, s);
  const invs = S.invoices.filter((i) => i.shipmentId === s.id);
  const excs = S.exceptions.filter((e) => e.shipmentId === s.id && e.status === "OPEN");
  const uninvoiced = charges.filter((c) => !c.invoiceId);
  const done = s.step >= LIFECYCLE.length - 1;

  return head({ eyebrow: "Shipment", title: s.reference,
    actions: `<button class="btn" data-act="advance" data-id="${s.id}" ${done ? "disabled" : ""}>
        ${done ? "Delivered" : `Advance → ${esc(LIFECYCLE[s.step + 1].label)}`}</button>
      <button class="btn" data-act="roll" data-id="${s.id}">Roll the booking</button>
      ${uninvoiced.length ? `<button class="btn primary" data-act="issueInv" data-id="${s.id}">Issue invoice</button>` : ""}`,
    lede: `${esc(lane(s))} · ${esc(partyName(s.customerId))} · ${esc(s.carrier || "carrier unassigned")}` })

  + `<div class="row" style="margin-bottom:14px">
      ${statusTag(s.status)}
      ${s.blNumber ? tag(`B/L ${s.blNumber}`) : tag("B/L not issued")}
      ${s.carrierBookingRef ? tag(`Booking ${s.carrierBookingRef}`) : ""}
      ${tag(`${s.containers.length} × ${s.containers[0] ? s.containers[0].type : "—"}`)}
      <span class="small muted">ETD ${day(s.etd)} · ETA ${day(s.eta)}</span>
    </div>`

  + (excs.length ? `<div class="note warn" style="margin-top:0">
      ${excs.map((e) => `<div><b>${esc(e.code.replace(/_/g, " "))}</b> — ${esc(e.detail)}</div>`).join("")}
    </div>` : "")

  + `<div class="grid g-53">
      <div class="stack">
        ${cons ? cargoPanel(cons, true) : ""}

        ${panel({ eyebrow: "Accrued by the event consumers", title: "Charges", flush: true, body:
          table([{ label: "Code" }, { label: "Line" }, { label: "Basis" }, { label: "Qty", align: "r" },
            { label: "Buy", align: "r" }, { label: "Sell", align: "r" }, { label: "Invoice" }],
            charges.map((c) => `<tr>
              <td><span class="mono" style="font-size:10.5px">${esc(c.code)}</span></td>
              <td class="p">${esc(c.description)}<div style="margin-top:3px">
                ${tag(PROV_LABEL[c.prov], PROV_TAG[c.prov])}
                <span class="small muted" style="margin-left:5px">${esc(c.triggeredBy)}</span></div></td>
              <td class="muted">${esc(basisPhrase(c.basis))}</td>
              <td class="r tab">${c.qty}</td>
              <td class="r tab muted">${c.buyCents == null ? "—" : money(c.buyCents, c.currency)}</td>
              <td class="r tab p">${money(c.sellCents, c.currency)}</td>
              <td>${c.invoiceId
                ? `<a href="#/invoices/${c.invoiceId}" class="mono small">${esc((S.invoices.find((i) => i.id === c.invoiceId) || {}).number || "")}</a>`
                : `<span class="muted small">unbilled</span>`}</td></tr>`),
            { emptyTitle: "Nothing accrued yet", emptyBody: "Charges are written by the consumers as the freight moves." }) })}

        ${panel({ eyebrow: "Append-only", title: "Event log", flush: true, body:
          `<div style="padding:2px 16px 14px">` + evts.slice().reverse().map((e) => `<div class="evt">
            <span class="ts mono">${stamp(e.occurredAt)}</span>
            <span class="ty mono">${esc(e.type)}</span>
            <span class="pl">${esc(e.src)} · ${esc(Object.entries(e.payload).slice(0, 2).map(([k, v]) => `${k}=${v}`).join("  "))}</span>
          </div>`).join("") + `</div>` })}
      </div>

      <div class="stack">
        ${panel({ eyebrow: "Milestones", title: "Where it is", body:
          `<div class="tl">` + LIFECYCLE.map((m, i) => {
            const cls = i < s.step ? "done" : i === s.step ? "now" : "";
            const ev = evts.find((e) => e.type === m.type);
            return `<div class="tl-step ${cls}">
              <div class="tl-rail"><span class="tl-dot"></span>${i < LIFECYCLE.length - 1 ? `<span class="tl-line"></span>` : ""}</div>
              <div class="tl-body"><div class="tl-t">${esc(m.label)}</div>
              <div class="tl-m">${ev ? stamp(ev.occurredAt) + " · " + esc(m.src) : "—"}</div></div></div>`;
          }).join("") + `</div>` })}

        ${panel({ eyebrow: "Equipment", title: "Containers", body:
          s.containers.map((c) => `<div class="kv"><span class="k">${esc(c.type)}</span>
            <span class="v">${c.number ? esc(c.number) : `<span class="muted">not yet assigned</span>`}</span></div>`).join("") })}

        ${entry ? panel({ eyebrow: "Customs", title: entry.reference,
          actions: `<a class="btn sm" href="#/customs/${entry.id}">Open</a>`, body:
          kv("Status", tag(entry.status, entry.status === "RELEASED" ? "good" : "warn", true))
          + kv("Duty", money(entryTotals(entry).duty))
          + kv("VAT", money(entryTotals(entry).vat))
          + kv("Payable to SARS", money(entryTotals(entry).total), "tot") })
          : panel({ eyebrow: "Customs", title: "No entry yet",
              actions: `<a class="btn sm" href="#/customs">Create one</a>`,
              body: `<p class="small muted" style="margin:0">Nothing has been lodged for this shipment.</p>` })}

        ${invs.length ? panel({ eyebrow: "Billing", title: "Invoices", body:
          invs.map((i) => `<div class="kv"><span class="k">
            <a href="#/invoices/${i.id}" class="mono">${esc(i.number)}</a></span>
            <span class="v">${money(i.totalCents, i.currency)} ${invTag(i.status)}</span></div>`).join("") }) : ""}
      </div>
    </div>`;
});

function cargoPanel(c, commercial) {
  const reqs = handlingRequirements(c);
  return panel({ eyebrow: "What is being shipped", title: "Cargo",
    actions: `${tag(CARGO_TYPES[c.cargoType].label, c.cargoType === "HAZARDOUS" ? "bad" : c.cargoType === "GENERAL" ? "" : "warn", true)}
      ${tag(URGENCY[c.urgency].label)}`,
    body: `<p style="margin:0 0 12px;font-size:13px" class="p">${esc(c.description)}</p>
      <div class="grid g4" style="gap:9px;margin-bottom:13px">
        ${tile("Pieces", num(c.pieces))}
        ${tile("Gross", kg(c.grossWeightGrams))}
        ${tile("Volume", cbm(c.volumeCm3))}
        ${tile("Chargeable", kg(c.chargeableWeightGrams), { tone: "accent",
          sub: c.volumetricApplies ? "billed on volume" : "billed on weight" })}
      </div>
      <div class="grid g2" style="gap:0 18px;margin-bottom:12px">
        ${kv("Port of exit", `<span class="mono">${esc(c.portOfExit)}</span>`)}
        ${kv("Port of entry", `<span class="mono">${esc(c.portOfEntry)}</span>`)}
        ${kv("Pick-up", c.pickupLocode ? `<span class="mono">${esc(c.pickupLocode)}</span>` : `<span class="muted">Delivered to port by shipper</span>`)}
        ${c.pickupAddress ? kv("Collection address", esc(c.pickupAddress)) : ""}
        ${c.unNumber ? kv("Dangerous goods", `<span class="mono">${esc(c.unNumber)} · class ${esc(c.imoClass)} · PG ${esc(c.packingGroup)}</span>`) : ""}
        ${c.tempMinDeciC != null ? kv("Temperature", `${(c.tempMinDeciC / 10).toFixed(1)} °C to ${(c.tempMaxDeciC / 10).toFixed(1)} °C`) : ""}
      </div>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>Contents</th><th>Packaging</th><th class="r">Pieces</th><th class="r">Weight</th><th>Per piece</th><th>Marks</th></tr></thead>
        <tbody>${c.items.map((i) => `<tr>
          <td class="p">${esc(i.description)}</td>
          <td>${esc(PACKAGE_TYPES[i.packageType] || i.packageType)}${i.stackable === false ? " " + tag("No stack", "warn") : ""}</td>
          <td class="r tab">${i.pieces}</td>
          <td class="r tab p">${kg(i.grossWeightGrams)}</td>
          <td>${i.lengthMm ? `${i.lengthMm / 10} × ${i.widthMm / 10} × ${i.heightMm / 10} cm` : "—"}</td>
          <td><span class="mono">${esc(i.marksAndNumbers || "—")}</span></td></tr>`).join("")}</tbody></table></div>
      ${commercial && reqs.length ? `<div style="margin-top:12px;border-top:1px solid var(--hairline);padding-top:11px">
        ${reqs.map((r) => `<div class="row" style="align-items:flex-start;gap:9px;margin-bottom:6px">
          ${tag(r.blocking ? "Required" : "Note", r.blocking ? "bad" : "warn", true)}
          <span class="small" style="flex:1;color:var(--t2)">${esc(r.description)}</span></div>`).join("")}
      </div>` : ""}` });
}

ACTIONS.advance = (n) => {
  if (!hasRole(S, "ops")) return toast("bad", "Refused", "Recording a milestone needs the ops role.");
  const m = advance(S, n.dataset.id);
  if (m) toast("info", m.label, `Recorded from ${m.src}. Any charge that hangs off it has accrued.`);
  render();
};

ACTIONS.roll = (n) => {
  const s = shipmentOf(n.dataset.id);
  if (S.exceptions.some((e) => e.shipmentId === s.id && e.code === "BOOKING_ROLLED" && e.status === "OPEN"))
    return toast("info", "Already rolled", "There is an open roll exception on this shipment.");
  emit(S, { type: "booking.rolled", tenantId: s.tenantId, shipmentId: s.id, src: "DCSA",
    payload: { reason: "Carrier omitted the port call", etaShift: "+7d" } });
  S.exceptions.push({ id: uid(S, "exc"), tenantId: s.tenantId, shipmentId: s.id, code: "BOOKING_ROLLED",
    status: "OPEN", detail: "Carrier omitted the port call; ETA moves out seven days.", raisedAt: S.now });
  s.eta += 7 * DAY;
  toast("warn", "Booking rolled", "An exception is open on the ops console and the ETA has moved.");
  render();
};

ACTIONS.issueInv = (n) => {
  if (!hasRole(S, "finance")) return toast("bad", "Refused", "Issuing an invoice needs the finance role.");
  try {
    const invs = issueInvoice(S, n.dataset.id, { customerReference: `PO-${88000 + S.seq}` });
    toast("good", `Issued ${invs[0].number}`, `${money(invs[0].totalCents, invs[0].currency)} due ${day(invs[0].dueDate)}.`);
    go(`/invoices/${invs[0].id}`);
  } catch (e) { toast("warn", "Nothing to invoice", e.message); }
};

/* =================================================================== ops */

route(/^\/ops$/, () => {
  const excs = S.exceptions.filter((e) => e.tenantId === tenantOf(S));
  const cols = [
    { code: "BOOKING_ROLLED", label: "Rolled bookings" },
    { code: "CUSTOMS_QUERY", label: "Customs queries" },
    { code: "CUSTOMS_STOP", label: "Customs stops" },
    { code: "COMPLIANCE_HOLD", label: "Compliance holds" },
  ];
  return head({ eyebrow: "Commercial", title: "What needs a human today",
    lede: "Exceptions are raised by the projector from the event stream, not typed in by anybody. Clearing one is a decision with a name on it." })
  + `<div class="kanban">` + cols.map((c) => {
    const items = excs.filter((e) => e.code === c.code && e.status === "OPEN");
    return `<div>
      <div class="col-head"><span>${esc(c.label)}</span><span>${items.length}</span></div>
      ${items.map((e) => { const s = shipmentOf(e.shipmentId); return `<div class="card" data-go="/shipments/${e.shipmentId}">
        <div class="ref">${esc(s ? s.reference : "—")}</div>
        <div class="ttl">${esc(e.detail)}</div>
        <div class="sub">${esc(s ? lane(s) : "")} · raised ${ago(e.raisedAt, S.now)}</div>
        <div class="row" style="margin-top:9px">
          <button class="btn sm" data-act="clearExc" data-id="${e.id}">Clear</button></div>
      </div>`; }).join("") || `<div class="empty" style="padding:18px"><div class="d">Nothing open.</div></div>`}
    </div>`;
  }).join("") + `</div>`;
});

ACTIONS.clearExc = (n) => {
  const e = S.exceptions.find((x) => x.id === n.dataset.id);
  e.status = "CLEARED";
  emit(S, { type: "shipment.exception_cleared", tenantId: e.tenantId, shipmentId: e.shipmentId,
    src: "projector", payload: { code: e.code } });
  toast("good", "Exception cleared", `${e.code.replace(/_/g, " ")} closed and written to the log.`);
  render();
};

/* =============================================================== customs */

route(/^\/customs$/, () => {
  const entries = S.entries.filter((e) => e.tenantId === tenantOf(S));
  const candidates = visibleShipments(S).filter((s) => s.step >= 4 && !entryFor(S, s));
  return head({ eyebrow: "Compliance", title: "Customs is where forwarders lose money",
    lede: "Duty on the customs value, then VAT on the added-tax value — customs value plus duty plus a 10% upliftment on non-SACU imports. The upliftment is the part people get wrong, and it moves the VAT base on every line." })
  + panel({ eyebrow: "Entries", title: "Declarations", flush: true, body:
      table([{ label: "Reference" }, { label: "Shipment" }, { label: "Lines", align: "r" },
        { label: "Customs value", align: "r" }, { label: "Duty", align: "r" }, { label: "VAT", align: "r" },
        { label: "Payable", align: "r" }, { label: "Status" }],
        entries.map((e) => { const t = entryTotals(e); const s = shipmentOf(e.shipmentId);
          return `<tr class="rowlink" data-go="/customs/${e.id}">
            <td><span class="mono" style="color:var(--accent-strong)">${esc(e.reference)}</span></td>
            <td class="p">${esc(s ? s.reference : "—")}</td>
            <td class="r tab">${e.lines.length}</td>
            <td class="r tab">${money(t.customsValue)}</td>
            <td class="r tab">${money(t.duty)}</td>
            <td class="r tab">${money(t.vat)}</td>
            <td class="r tab p">${money(t.total)}</td>
            <td>${tag(e.status, e.status === "RELEASED" ? "good" : e.status === "DRAFT" ? "" : "warn", true)}</td></tr>`; }),
        { emptyTitle: "No entries yet", emptyBody: "Lodge one against a shipment that has reached the port." }) })
  + (candidates.length ? `<div style="height:16px"></div>` + panel({
      eyebrow: "Waiting", title: "Shipments with no entry", flush: true, body:
      table([{ label: "Reference" }, { label: "Lane" }, { label: "Goods" }, { label: "" }],
        candidates.map((s) => { const c = S.consignments.find((x) => x.id === s.consignmentId);
          return `<tr><td><span class="mono">${esc(s.reference)}</span></td>
            <td>${esc(lane(s))}</td><td class="p">${esc(c ? c.description : "—")}</td>
            <td class="r"><button class="btn sm" data-act="newEntry" data-id="${s.id}">Create entry</button></td></tr>`; })) }) : "");
});

ACTIONS.newEntry = (n) => {
  const s = shipmentOf(n.dataset.id);
  const c = S.consignments.find((x) => x.id === s.consignmentId);
  const guess = classify(c ? c.description : "")[0];
  const e = createEntry(S, s.id, [{
    description: c ? c.description : "Goods",
    hsCode: guess ? guess.hs : null, dutyRateBps: guess ? guess.rateBps : 0,
    customsValueCents: 45_000_000 + s.containers.length * 38_000_000, sacuOrigin: false,
  }]);
  toast("good", `Entry ${e.reference} prepared`, guess
    ? `Classified ${guess.hs} at ${(guess.confidence * 100).toFixed(0)}% confidence — confirm it before lodging.`
    : "No tariff match; classify the line by hand.");
  go(`/customs/${e.id}`);
};

route(/^\/customs\/(.+)$/, (id) => {
  const e = S.entries.find((x) => x.id === id);
  if (!e || e.tenantId !== tenantOf(S)) return empty("Not found", "No such entry in this tenant.");
  const s = shipmentOf(e.shipmentId);
  const t = entryTotals(e);
  const allConfirmed = e.lines.every((l) => l.confirmed && l.hsCode);
  const filing = S.filings.find((f) => f.shipmentId === e.shipmentId);

  return head({ eyebrow: "Customs entry", title: e.reference,
    lede: `${esc(s ? s.reference : "")} · ${esc(s ? lane(s) : "")}`,
    actions: `${e.status === "DRAFT" ? `<button class="btn primary" data-act="submitEntry" data-id="${e.id}" ${allConfirmed ? "" : "disabled"}>Lodge with SARS</button>` : ""}
      ${e.status === "SUBMITTED" ? `<button class="btn" data-act="releaseEntry" data-id="${e.id}">Record release</button>` : ""}` })

  + `<div class="row" style="margin-bottom:14px">${tag(e.status, e.status === "RELEASED" ? "good" : e.status === "DRAFT" ? "" : "warn", true)}
      ${allConfirmed ? tag("All lines classified", "good") : tag("Classification incomplete", "warn")}</div>`

  + `<div class="grid g-53"><div class="stack">
      ${panel({ eyebrow: "Declaration", title: "Lines", flush: true, body:
        table([{ label: "Goods" }, { label: "HS code" }, { label: "Duty rate", align: "r" },
          { label: "Customs value", align: "r" }, { label: "Duty", align: "r" }, { label: "ATV", align: "r" },
          { label: "VAT", align: "r" }, { label: "" }],
          e.lines.map((l, i) => { const d = dutyForLine(l); return `<tr>
            <td class="p">${esc(l.description)}</td>
            <td><span class="mono">${esc(l.hsCode || "—")}</span>
              ${l.confirmed ? tag("Confirmed", "good") : tag("Unconfirmed", "warn")}</td>
            <td class="r tab">${pct(l.dutyRateBps)}</td>
            <td class="r tab">${money(l.customsValueCents)}</td>
            <td class="r tab">${money(d.duty)}</td>
            <td class="r tab muted">${money(d.atv)}</td>
            <td class="r tab p">${money(d.vat)}</td>
            <td class="r">${l.confirmed ? "" : `<button class="btn sm" data-act="confirmLine" data-id="${e.id}" data-i="${i}">Confirm</button>`}</td>
          </tr>`; })) })}

      ${panel({ eyebrow: "Classification", title: "Tariff lookup", body: `
        <div class="row" style="margin-bottom:11px">
          <input class="ctl" style="flex:1" id="hsq" placeholder="Describe the goods — cotton knitted shirts" value="${esc(e.lines[0] ? e.lines[0].description : "")}">
          <button class="btn" data-act="classify">Search the book</button>
        </div>
        <div id="hsres">${classifyRows(classify(e.lines[0] ? e.lines[0].description : ""))}</div>` })}
    </div>

    <div class="stack">
      ${panel({ eyebrow: "Payable", title: "Duty and VAT", body:
        kv("Customs value", money(t.customsValue))
        + kv("Duty", money(t.duty))
        + kv("Added-tax value", money(t.atv))
        + kv("VAT @ 15%", money(t.vat))
        + kv("Payable to SARS", `<span class="accent">${money(t.total)}</span>`, "tot")
        + `<p class="small muted" style="margin:10px 0 0">
            VAT is charged on the ATV, not on the customs value: value + duty + 10% upliftment on
            non-SACU imports. Computing it on the invoice value alone understates every entry.</p>` })}

      ${panel({ eyebrow: "SARS", title: "Electronic filing",
        actions: `<button class="btn sm" data-act="lodgeFiling" data-id="${e.id}">Build the submission</button>`, body:
        filing ? kv("Filing", `<span class="mono">${esc(filing.kind)}</span>`)
          + kv("State", tag(filing.status, filing.status === "QUEUED" ? "warn" : "good", true))
          + kv("Our reference", `<span class="mono">${esc(filing.submissionRef)}</span>`)
          + kv("Authority reference", filing.authorityRef ? `<span class="mono">${esc(filing.authorityRef)}</span>` : `<span class="muted">—</span>`)
          + (filing.lastError ? `<p class="small" style="margin:10px 0 0;color:var(--warning)">${esc(filing.lastError)}</p>` : "")
          : `<p class="small muted" style="margin:0">Nothing built yet. The declaration is validated against the tariff book and stored whether or not the EDI channel is configured — see <a href="#/integrations">External Systems</a>.</p>` })}
    </div></div>`;
});

const classifyRows = (rows) => rows.length
  ? rows.map((r) => `<div class="kv"><span class="k">
      <span class="mono p">${esc(r.hs)}</span> ${esc(r.desc)}</span>
      <span class="v">${pct(r.rateBps)} <span class="muted">· ${(r.confidence * 100).toFixed(0)}%</span></span></div>`).join("")
  : `<p class="small muted" style="margin:0">No candidate in the tariff extract matched.</p>`;

ACTIONS.classify = () => { $("#hsres").innerHTML = classifyRows(classify($("#hsq").value)); };
ACTIONS.confirmLine = (n) => {
  const e = S.entries.find((x) => x.id === n.dataset.id);
  const l = e.lines[Number(n.dataset.i)];
  if (!l.hsCode) { const g = classify(l.description)[0]; if (g) { l.hsCode = g.hs; l.dutyRateBps = g.rateBps; } }
  l.confirmed = true;
  toast("good", "Line confirmed", `${l.hsCode} at ${pct(l.dutyRateBps)} — a human has taken responsibility for the classification.`);
  render();
};
ACTIONS.submitEntry = (n) => {
  const e = S.entries.find((x) => x.id === n.dataset.id);
  e.status = "SUBMITTED";
  emit(S, { type: "entry.submitted", tenantId: e.tenantId, shipmentId: e.shipmentId,
    payload: { entryId: e.id, reference: e.reference, payable: money(entryTotals(e).total) } });
  lodgeFiling(S, e.shipmentId, "SARS_CUSDEC", { reference: e.reference, lines: e.lines.length });
  toast("info", "Entry lodged", "Built, validated and stored. The EDI channel is not configured, so it is queued for manual capture.");
  render();
};
ACTIONS.releaseEntry = (n) => {
  const e = S.entries.find((x) => x.id === n.dataset.id);
  const s = shipmentOf(e.shipmentId);
  e.status = "RELEASED";
  emit(S, { type: "entry.released", tenantId: e.tenantId, shipmentId: e.shipmentId, src: "SARS",
    payload: { entryId: e.id, reference: e.reference } });
  accrueFor(S, s, "entry.released");
  toast("good", "Released", `Duty and VAT of ${money(entryTotals(e).total)} accrued as a pass-through disbursement.`);
  render();
};
ACTIONS.lodgeFiling = (n) => {
  const e = S.entries.find((x) => x.id === n.dataset.id);
  const t = entryTotals(e);
  const f = lodgeFiling(S, e.shipmentId, "SARS_CUSDEC", { reference: e.reference,
    lines: e.lines.length, customsValue: money(t.customsValue), duty: money(t.duty), vat: money(t.vat) });
  toast(f.status === "QUEUED" ? "warn" : "good", `Filing ${f.status.toLowerCase()}`,
    f.lastError || `Lodged with SARS as ${f.authorityRef}.`);
  render();
};

/* ============================================================= documents */

route(/^\/documents$/, () => {
  const docs = S.documents.filter((d) => d.tenantId === tenantOf(S));
  const queue = docs.filter((d) => d.status === "NEEDS_REVIEW");
  return head({ eyebrow: "Compliance", title: "Documents",
    lede: "Extraction proposes; a human disposes. Anything below the confidence threshold is queued rather than guessed at — these numbers end up on a customs declaration." })
  + `<div class="grid g4" style="margin-bottom:16px">
      ${tile("Documents", String(docs.length))}
      ${tile("Awaiting review", String(queue.length), { tone: queue.length ? "warn" : "good" })}
      ${tile("Threshold", "85%", { sub: "Below this, a person reads it" })}
      ${tile("Extraction", INTEGRATIONS.find((i) => i.key === "extraction").live ? "Live" : "Manual only",
        { tone: INTEGRATIONS.find((i) => i.key === "extraction").live ? "good" : "warn" })}
    </div>`
  + panel({ flush: true, body: table(
      [{ label: "File" }, { label: "Kind" }, { label: "Shipment" }, { label: "Confidence", align: "r" },
       { label: "Extracted fields" }, { label: "Status" }, { label: "" }],
      docs.map((d) => { const s = shipmentOf(d.shipmentId); return `<tr>
        <td class="p"><span class="mono" style="font-size:11px">${esc(d.filename)}</span></td>
        <td>${tag(d.kind.replace(/_/g, " "))}</td>
        <td><a href="#/shipments/${d.shipmentId}" class="mono small">${esc(s ? s.reference : "—")}</a></td>
        <td class="r tab ${d.confidence < 0.85 ? "" : "p"}" style="${d.confidence < 0.85 ? "color:var(--warning)" : ""}">${(d.confidence * 100).toFixed(0)}%</td>
        <td class="small">${Object.entries(d.fields).map(([k, v]) => `<span class="muted">${esc(k)}</span> ${esc(v)}`).join(" · ")}</td>
        <td>${tag(d.status.replace(/_/g, " "), d.status === "NEEDS_REVIEW" ? "warn" : d.status === "APPROVED" ? "good" : "accent", true)}</td>
        <td class="r">${d.status === "NEEDS_REVIEW"
          ? `<button class="btn sm" data-act="approveDoc" data-id="${d.id}">Approve</button>`
          : ""}</td></tr>`; })) });
});

ACTIONS.approveDoc = (n) => {
  const d = S.documents.find((x) => x.id === n.dataset.id);
  d.status = "APPROVED";
  emit(S, { type: "document.approved", tenantId: d.tenantId, shipmentId: d.shipmentId,
    payload: { filename: d.filename, by: currentUser(S).name } });
  toast("good", "Approved", `${d.filename} — the correction is attributed to ${currentUser(S).name}.`);
  render();
};

/* =============================================================== parties */

route(/^\/parties$/, () => {
  const parties = S.parties.filter((p) => p.tenantId === tenantOf(S));
  const tone = { CLEAR: "good", REVIEW: "warn", HIT: "bad", UNSCREENED: "" };
  return head({ eyebrow: "Compliance", title: "Parties",
    lede: "Every party is screened against consolidated sanctions lists at creation and again at booking. A REVIEW verdict is a person's decision, not a threshold's.",
    actions: `<button class="btn primary" data-act="newParty">Add a party</button>` })
  + panel({ flush: true, body: table(
      [{ label: "Name" }, { label: "Country" }, { label: "VAT / tax" }, { label: "Screening" }, { label: "Portal access" }],
      parties.map((p) => `<tr>
        <td class="p">${esc(p.name)}${p.address ? `<div class="small muted">${esc(p.address.split("\n")[0])}</div>` : ""}</td>
        <td><span class="mono">${esc(p.country || "—")}</span></td>
        <td><span class="mono">${esc(p.taxId || "—")}</span></td>
        <td>${tag(p.screening, tone[p.screening], true)}</td>
        <td>${p.customerTenantId
          ? tag("Linked", "accent") + ` <span class="small muted">${esc((S.tenants.find((t) => t.id === p.customerTenantId) || {}).short || "")}</span>`
          : `<span class="small muted">none — invisible by default</span>`}</td></tr>`)) })
  + `<div class="note" style="margin-top:16px">
      <b>Portal access is a grant, not a default.</b> A shipper is a party inside the forwarder's
      tenant until somebody links it to a customer tenant. That link is the only route by which
      data crosses a tenant boundary anywhere in the platform — no link, no visibility.</div>`;
});

ACTIONS.newParty = () => {
  const name = prompt("Party name");
  if (!name) return;
  const p = { id: uid(S, "p"), tenantId: tenantOf(S), name, country: "ZA", screening: "UNSCREENED",
    address: null, taxId: null, email: null, customerTenantId: null, createdAt: S.now };
  S.parties.push(p);
  /* Screened on creation, exactly as the real service does — and the verdict
     is recorded as an event whether it clears or not. */
  const hit = /orion|shell company|sanction/i.test(name);
  p.screening = hit ? "REVIEW" : "CLEAR";
  emit(S, { type: "party.screened", tenantId: p.tenantId, src: "yente",
    payload: { partyId: p.id, name, verdict: p.screening } });
  toast(hit ? "warn" : "good", `Screened: ${p.screening}`,
    hit ? "A name match needs a human decision before this party can book." : "No watchlist match.");
  render();
};

/* =========================================================== integrations */

route(/^\/integrations$/, () => {
  const live = INTEGRATIONS.filter((i) => i.live).length;
  const accred = INTEGRATIONS.filter((i) => i.accred && !i.live);
  const blocking = INTEGRATIONS.filter((i) => i.prod && !i.live);
  const byDomain = {};
  for (const i of INTEGRATIONS) (byDomain[i.domain] = byDomain[i.domain] || []).push(i);
  const filings = S.filings.filter((f) => f.tenantId === tenantOf(S));

  return head({ eyebrow: "Platform", title: "Half the value chain is somebody else's system",
    lede: "The revenue authority, the carrier, the terminal, the index publisher. Several cannot be switched on with a URL — they need a registration or a certificate a person has to apply for. Every one is wired, config-gated, and honest about being dark." })

  + `<div class="grid g4" style="margin-bottom:16px">
      ${tile("External systems", String(INTEGRATIONS.length), { sub: "Wired in the product" })}
      ${tile("Live here", String(live), { tone: "good", sub: "Configured in this environment" })}
      ${tile("Need accreditation", String(accred.length), { tone: accred.length ? "warn" : "good", sub: "Paperwork, not code" })}
      ${tile("Hard dependencies", "0", { tone: "accent", sub: "Every one degrades to a stated partial" })}
    </div>

    ${blocking.length ? `<div class="note warn"><b>Not production-ready as configured.</b>
      ${esc(blocking.map((i) => i.name).join(", "))} ${blocking.length === 1 ? "is" : "are"} required
      before this deployment can carry real freight.</div>` : ""}

    <div class="grid g-53"><div class="stack">`
    + Object.entries(byDomain).map(([d, items]) => panel({ eyebrow: "Domain", title: d, body:
        items.map((i) => `<div style="padding:10px 0;border-bottom:1px solid var(--hairline)">
          <div class="row" style="gap:8px">
            <span class="p" style="font-weight:500">${esc(i.name)}</span>
            ${tag(i.live ? "Live" : "Not configured", i.live ? "good" : "", true)}
            ${i.prod && !i.live ? tag("Required for production", "bad") : ""}
            <span class="small muted" style="margin-left:auto">${esc(i.provider)}</span>
            <button class="btn sm" data-act="toggleInt" data-k="${i.key}">${i.live ? "Turn off" : "Turn on"}</button>
          </div>
          <p class="small muted" style="margin:5px 0 0">${esc(i.why)}</p>
          ${!i.live ? `<p class="small" style="margin:5px 0 0;color:var(--t2)"><b>Without it:</b> ${esc(i.degrade)}</p>` : ""}
          ${i.accred && !i.live ? `<p class="small" style="margin:6px 0 0;padding:6px 9px;border:1px dotted var(--hairline);border-radius:3px;color:var(--warning)">
            <b>Accreditation required.</b> ${esc(i.accred)}</p>` : ""}
          <div class="row" style="gap:5px;margin-top:6px">${i.keys.map((k) =>
            `<span class="mono" style="font-size:10px;padding:2px 6px;border-radius:3px;border:1px solid ${
              i.live ? "color-mix(in srgb, var(--success) 34%, transparent);color:var(--success)"
                     : "var(--hairline);color:var(--t3)"}">${esc(k)}</span>`).join("")}</div>
        </div>`).join("") })).join('<div style="height:14px"></div>')
    + `</div><div class="stack">
        ${panel({ eyebrow: "Try it", title: "Turn the feeds on", body: `
          <p class="small muted" style="margin:0 0 10px">
            The fuel index and the terminal gate feed change what the invoice audit can check.
            Switch them on, then re-run a match: the two findings that said "cannot be validated"
            become real comparisons against a benchmark. Switch them off and the audit says so
            again rather than quietly passing the lines.</p>
          <div class="row">
            <button class="btn" data-act="toggleInt" data-k="fuel_index">Fuel index ${INTEGRATIONS.find((i) => i.key === "fuel_index").live ? "off" : "on"}</button>
            <button class="btn" data-act="toggleInt" data-k="terminal">Terminal events ${INTEGRATIONS.find((i) => i.key === "terminal").live ? "off" : "on"}</button>
          </div>` })}

        ${panel({ eyebrow: "SARS", title: "Statutory filings", flush: true, body:
          `<div style="padding:0 16px 6px"><p class="small muted" style="margin:0 0 10px">
            Declarations are built, validated against the tariff book and stored complete whether or
            not the channel exists. They stop at QUEUED with the reason on them — a working state,
            not a broken one.</p></div>`
          + table([{ label: "Kind" }, { label: "State" }, { label: "Our ref" }, { label: "Authority ref" }],
            filings.map((f) => `<tr>
              <td><span class="mono p">${esc(f.kind)}</span></td>
              <td>${tag(f.status, f.status === "QUEUED" ? "warn" : "good", true)}</td>
              <td><span class="mono small">${esc(f.submissionRef)}</span></td>
              <td><span class="mono small">${esc(f.authorityRef || "—")}</span></td></tr>`),
            { emptyTitle: "No filings yet", emptyBody: "Lodge an entry from the customs workspace." }) })}
      </div></div>`;
});

ACTIONS.toggleInt = (n) => {
  const i = INTEGRATIONS.find((x) => x.key === n.dataset.k);
  i.live = !i.live;
  toast(i.live ? "good" : "warn", `${i.name} ${i.live ? "enabled" : "disabled"}`,
    i.live ? "Re-run an invoice audit to see the checks it unlocks." : i.degrade);
  render();
};
