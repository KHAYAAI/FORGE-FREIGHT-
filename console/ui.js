/* ==========================================================================
 * SHELL — chrome, navigation, routing, and the small building blocks the
 * screens are written in.
 * ======================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const S = populate(seed());

/* ---------------------------------------------------------------- atoms -- */

const tag = (text, tone = "", dot = false) =>
  `<span class="tag ${tone}">${dot ? "<i></i>" : ""}${esc(text)}</span>`;

const tile = (k, v, o = {}) =>
  `<div class="tile ${o.tone || ""}"><div class="k">${esc(k)}</div>
   <div class="v">${o.raw ? v : esc(v)}</div>${o.sub ? `<div class="s">${o.sub}</div>` : ""}</div>`;

const panel = (o) => `<section class="panel ${o.flush ? "flush" : ""}">
  ${o.title ? `<div class="panel-head" ${o.flush ? 'style="padding:14px 16px 6px"' : ""}>
    <div>${o.eyebrow ? `<div class="eyebrow ${o.eyebrowTone || ""}">${esc(o.eyebrow)}</div>` : ""}
    <h2>${esc(o.title)}</h2></div>
    ${o.actions ? `<div class="actions">${o.actions}</div>` : ""}</div>` : ""}
  ${o.body}</section>`;

const empty = (t, d) => `<div class="empty"><div class="t">${esc(t)}</div><div class="d">${esc(d)}</div></div>`;

const kv = (k, v, cls = "") => `<div class="kv ${cls}"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`;

function table(cols, rows, o = {}) {
  if (!rows.length) return empty(o.emptyTitle || "Nothing here yet", o.emptyBody || "");
  return `<div class="scroll-x"><table class="tbl"><thead><tr>${
    cols.map((c) => `<th ${c.align === "r" ? 'class="r"' : ""}>${esc(c.label)}</th>`).join("")
  }</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function toast(kind, title, detail) {
  const box = $("#toasts");
  /* Capped. An operator running a batch of actions should see the last few,
     not a column of notices covering the screen they are trying to read. */
  while (box.children.length >= 3) box.firstChild.remove();
  const n = document.createElement("div");
  n.className = `toast ${kind}`;
  n.innerHTML = `<div class="tt">${esc(title)}</div>${detail ? `<div class="td">${esc(detail)}</div>` : ""}`;
  box.appendChild(n);
  setTimeout(() => { n.style.transition = "opacity .3s"; n.style.opacity = "0";
    setTimeout(() => n.remove(), 320); }, 4600);
}

/* --------------------------------------------------------------- routes -- */

/* Which kind of tenant a route belongs to. Hiding a nav item is presentation,
   not access control — typing the path in still has to be refused, which is
   what `guard()` below does. */
const OPERATIONAL = ["OPERATOR", "PARTNER_AGENT"];

const NAV = [
  { group: "Overview", items: [
    { path: "/",                 label: "Dashboard",        for: OPERATIONAL },
    { path: "/system",           label: "System Monitor",   for: ["OPERATOR"] },
    { path: "/track",            label: "My Shipments",     for: ["CUSTOMER"] },
    { path: "/track/invoices",   label: "My Invoices",      for: ["CUSTOMER"] },
  ] },
  { group: "Commercial", items: [
    { path: "/quotes/new",       label: "New Quote",        for: OPERATIONAL },
    { path: "/rates",            label: "Rates & Margin",   for: OPERATIONAL },
    { path: "/shipments",        label: "Shipments",        for: OPERATIONAL, count: () => visibleShipments(S).filter((s) => s.status !== "DELIVERED").length },
    { path: "/ops",              label: "Ops Console",      for: OPERATIONAL, count: () => openExceptions().length, tone: "bad" },
  ] },
  { group: "Compliance", items: [
    { path: "/customs",          label: "Customs",          for: OPERATIONAL },
    { path: "/documents",        label: "Documents",        for: OPERATIONAL, count: () => S.documents.filter((d) => d.tenantId === tenantOf(S) && d.status === "NEEDS_REVIEW").length, tone: "warn" },
    { path: "/parties",          label: "Parties",          for: OPERATIONAL },
    { path: "/integrations",     label: "External Systems", for: OPERATIONAL },
  ] },
  { group: "Finance", items: [
    { path: "/invoices",         label: "Invoices",         for: OPERATIONAL },
    { path: "/billing/exceptions", label: "Invoice Audit",  for: OPERATIONAL, count: () => openFindings().length, tone: "warn" },
    { path: "/billing/settings", label: "Billing Settings", for: OPERATIONAL },
    { path: "/finance",          label: "Finance Views",    for: OPERATIONAL },
    { path: "/platform-fees",    label: "Platform Fees",    for: ["PARTNER_AGENT"] },
  ] },
  { group: "Infrastructure", items: [
    { path: "/partners",         label: "Partners",         for: ["OPERATOR"] },
  ] },
];

const openExceptions = () => S.exceptions.filter((e) => e.tenantId === tenantOf(S) && e.status === "OPEN");
const openFindings = () => S.invoiceExceptions.filter((e) => e.tenantId === tenantOf(S)
  && (e.status === "OPEN" || e.status === "DISPUTED"));

function tenantType() { return S.tenants.find((t) => t.id === tenantOf(S)).type; }

/* The authority the nav merely reflects. A customer typing /invoices gets sent
   home rather than a page of error states dressed up as a screen. */
function mayVisit(path) {
  const tt = tenantType();
  const customerOnly = path === "/track" || path.startsWith("/track/");
  if (customerOnly) return tt === "CUSTOMER";
  const operational = ["/", "/system", "/quotes", "/rates", "/shipments", "/ops", "/customs",
    "/documents", "/parties", "/integrations", "/invoices", "/billing", "/finance",
    "/platform-fees", "/partners"];
  if (operational.some((p) => path === p || path.startsWith(p + "/"))) return tt !== "CUSTOMER";
  return true;
}
const homePath = () => (tenantType() === "CUSTOMER" ? "/track" : "/");

/* ---------------------------------------------------------------- chrome */

function renderShell() {
  const t = S.tenants.find((x) => x.id === tenantOf(S));
  const u = currentUser(S);
  const rails = t.type === "PARTNER_AGENT";

  $("#brand").innerHTML = `
    <div class="mark ${rails ? "rails" : ""}">${esc(t.av[0])}</div>
    <div><div class="brand-name">${esc(t.short)}</div>
    <div class="brand-sub">Freight OS</div></div>`;

  const path = currentPath();
  $("#nav").innerHTML = NAV.map((g) => {
    const items = g.items.filter((i) => i.for.includes(t.type));
    if (!items.length) return "";
    return `<div class="nav-group">${esc(g.group)}</div>` + items.map((i) => {
      const on = i.path === "/" ? path === "/" : path.startsWith(i.path);
      const c = i.count ? i.count() : null;
      return `<a class="nav-link" href="#${i.path}" aria-current="${on ? "page" : "false"}">
        <span>${esc(i.label)}</span>
        ${c ? `<span class="count ${i.tone || ""}">${c}</span>` : ""}</a>`;
    }).join("");
  }).join("");

  $("#who").innerHTML = `
    <span class="av ${rails ? "rails" : ""}">${esc(t.av)}</span>
    <span><b>${esc(u.name)}</b> <span class="muted">· ${esc(t.short)}</span></span>
    <span class="caret">▾</span>`;

  $("#roles").innerHTML = u.roles.length
    ? u.roles.map((r) => tag(r)).join(" ")
    : `<span class="small muted">portal user</span>`;
}

function renderMenu() {
  const open = $("#menu").hidden === false;
  if (!open) return;
  $("#menu").innerHTML = S.users.map((u) => {
    const t = S.tenants.find((x) => x.id === u.tenantId);
    return `<button data-user="${u.id}" aria-pressed="${u.id === S.session.userId}">
      <span class="av ${t.type === "PARTNER_AGENT" ? "rails" : ""}">${esc(t.av)}</span>
      <span><span class="nm">${esc(u.name)}</span>
      <span class="rl">${esc(t.short)} · ${esc(t.type.toLowerCase().replace("_", " "))}${u.roles.length ? " · " + u.roles.join(" ") : ""}</span></span>
    </button>`;
  }).join("") + `<div class="sep"></div>
    <button data-action="reset"><span class="av">↺</span>
    <span><span class="nm">Reset the demo</span>
    <span class="rl">Rebuild the seeded book from scratch</span></span></button>`;
}

/* --------------------------------------------------------------- router -- */

const currentPath = () => (location.hash.slice(1) || "/").split("?")[0];

const ROUTES = [];
const route = (re, fn) => ROUTES.push({ re, fn });

function render() {
  let path = currentPath();
  if (!mayVisit(path)) {
    toast("warn", "Not your screen",
      `A ${tenantType().toLowerCase().replace("_", " ")} tenant has no access to ${path}.`);
    location.hash = homePath();
    return;
  }
  const view = $("#view");
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) {
      view.innerHTML = r.fn(...m.slice(1));
      view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter");
      renderShell();
      window.scrollTo({ top: 0 });
      bind();
      return;
    }
  }
  view.innerHTML = empty("No such screen", `Nothing is routed at ${path}.`);
  renderShell();
}

const go = (p) => { location.hash = p; };

/* Delegated so screens never wire their own listeners — every screen is a
   pure string of HTML, re-rendered from state, and nothing survives a render
   that shouldn't. */
function bind() {
  $$("[data-go]").forEach((n) => n.addEventListener("click", (e) => {
    if (e.target.closest("button,a,input")) return;
    go(n.dataset.go);
  }));
  $$("[data-act]").forEach((n) => n.addEventListener("click", (e) => {
    e.stopPropagation();
    ACTIONS[n.dataset.act] && ACTIONS[n.dataset.act](n, e);
  }));
  $$("[data-live]").forEach((n) => n.addEventListener("input", () => {
    LIVE[n.dataset.live] && LIVE[n.dataset.live](n);
  }));
  $$("[data-change]").forEach((n) => n.addEventListener("change", () => {
    LIVE[n.dataset.change] && LIVE[n.dataset.change](n);
  }));
}

const ACTIONS = {};
const LIVE = {};

/* ---------------------------------------------------------------- header */

const head = (o) => `<div class="page-head">
  <div class="bar">
    <div>
      <div class="eyebrow ${o.tone || ""}">${esc(o.eyebrow)}</div>
      <h1>${esc(o.title)}</h1>
    </div>
    ${o.actions ? `<div class="actions">${o.actions}</div>` : ""}
  </div>
  ${o.lede ? `<p style="margin-top:8px">${o.lede}</p>` : ""}
</div>`;

const back = (href, label) => `<a href="#${href}" class="small">← ${esc(label)}</a>`;
