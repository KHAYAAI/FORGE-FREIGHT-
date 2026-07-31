import type { TenantType } from "./types";

/**
 * Which kind of tenant a console route belongs to.
 *
 * Hiding a nav item is presentation, not access control — the sidebar already
 * filters by tenant type, but typing `/finance` into the address bar as a
 * customer still rendered the operator screen. The API refuses the underlying
 * calls, so nothing leaked, but the result was a page of error states dressed
 * up as a screen the customer was entitled to. This table is the authority the
 * nav merely reflects.
 */
export type RouteAudience = "operational" | "customer" | "shared";

/** Screens that belong to a forwarder or a partner agent running its own book. */
const OPERATIONAL_PREFIXES = [
  "/system",
  "/quotes",
  "/shipments",
  "/ops",
  "/customs",
  "/documents",
  "/parties",
  "/invoices",
  "/finance",
  "/platform-fees",
  "/partners",
  "/network",
];

/** The shipper portal. */
const CUSTOMER_PREFIXES = ["/track"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function audienceOf(pathname: string): RouteAudience {
  if (matches(pathname, CUSTOMER_PREFIXES)) return "customer";
  if (matches(pathname, OPERATIONAL_PREFIXES)) return "operational";
  return "shared";
}

/** Where a tenant of this type belongs when it asks for a route that isn't its own. */
export function homeFor(tenantType: TenantType): string {
  return tenantType === "CUSTOMER" ? "/track" : "/";
}

/** True when this tenant type may see this route. */
export function mayVisit(tenantType: TenantType, pathname: string): boolean {
  const audience = audienceOf(pathname);
  if (audience === "shared") return true;
  return audience === "customer" ? tenantType === "CUSTOMER" : tenantType !== "CUSTOMER";
}
