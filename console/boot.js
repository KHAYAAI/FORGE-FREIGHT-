/* ==========================================================================
 * BOOT — wiring the chrome, then handing over to the router.
 * ======================================================================== */

/* The seat switcher. Changing it changes the tenant predicate on every query
   and the roles on every write — not the nav. A customer seat is a different
   product reading the same database. */
$("#who").addEventListener("click", (e) => {
  e.stopPropagation();
  const m = $("#menu");
  m.hidden = !m.hidden;
  $("#who").setAttribute("aria-expanded", String(!m.hidden));
  renderMenu();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#menu") && !e.target.closest("#who")) $("#menu").hidden = true;
});

$("#menu").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  $("#menu").hidden = true;
  if (b.dataset.action === "reset") {
    location.reload();
    return;
  }
  const u = S.users.find((x) => x.id === b.dataset.user);
  S.session.userId = u.id;
  const t = S.tenants.find((x) => x.id === u.tenantId);
  toast("info", `Signed in as ${u.name}`,
    `${t.name} · ${t.type.toLowerCase().replace("_", " ")}${u.roles.length ? ` · ${u.roles.join(", ")}` : " · portal only"}`);
  if (!mayVisit(currentPath())) location.hash = homePath();
  else render();
});

/* Mirrors the console's own toggle. The viewer's OS preference is the default;
   this stamps an override that wins in both directions. */
const themeBtn = $("#theme");
function syncTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : !window.matchMedia("(prefers-color-scheme: light)").matches;
  themeBtn.textContent = dark ? "Light" : "Dark";
}
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme
    || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = cur === "dark" ? "light" : "dark";
  syncTheme();
});
syncTheme();

window.addEventListener("hashchange", render);

/* The clock advances with the work, not with the wall — so ageing, overdue
   sweeps and dispute windows all move when you do something, and stand still
   while you read. */
setInterval(() => {
  S.now += 60000;
  const n = markOverdue(S);
  if (n) { toast("warn", `${n} invoice(s) went overdue`, "The hourly sweep moved them; the finance screens follow."); render(); }
}, 45000);

render();

/* A first-run nudge, once. The seeded book is deep enough that "where do I
   start" is a real question. */
setTimeout(() => {
  toast("info", "This is the console, seeded with a book of freight",
    "Price a corridor, advance a shipment, then open an invoice and run the four-way match. The badge top-right changes seats.");
}, 700);
