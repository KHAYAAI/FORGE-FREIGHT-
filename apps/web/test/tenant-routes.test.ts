import { describe, expect, it } from "vitest";
import { audienceOf, homeFor, mayVisit } from "@/lib/tenant-routes";
import { NAV_ITEMS } from "@/components/shell/nav-items";

describe("route audience", () => {
  it("classifies the portal as the customer's and the console as the operator's", () => {
    expect(audienceOf("/track")).toBe("customer");
    expect(audienceOf("/track/invoices")).toBe("customer");
    expect(audienceOf("/track/abc-123")).toBe("customer");
    expect(audienceOf("/finance")).toBe("operational");
    expect(audienceOf("/system")).toBe("operational");
    expect(audienceOf("/shipments/abc-123")).toBe("operational");
    expect(audienceOf("/")).toBe("shared");
  });

  it("matches on path segments, not string prefixes", () => {
    // `/trackers` is not a portal route just because it starts with `/track`.
    expect(audienceOf("/trackers")).toBe("shared");
    expect(audienceOf("/systemic")).toBe("shared");
  });
});

describe("mayVisit", () => {
  it("keeps a customer out of every operator screen", () => {
    for (const path of ["/system", "/shipments", "/ops", "/finance", "/parties", "/network"]) {
      expect(mayVisit("CUSTOMER", path)).toBe(false);
    }
  });

  it("keeps operators and partner agents out of the shipper portal", () => {
    expect(mayVisit("OPERATOR", "/track")).toBe(false);
    expect(mayVisit("PARTNER_AGENT", "/track/invoices")).toBe(false);
  });

  it("lets each side into its own", () => {
    expect(mayVisit("CUSTOMER", "/track")).toBe(true);
    expect(mayVisit("OPERATOR", "/finance")).toBe(true);
    expect(mayVisit("PARTNER_AGENT", "/shipments")).toBe(true);
  });

  it("lets everyone at the shared landing page", () => {
    expect(mayVisit("CUSTOMER", "/")).toBe(true);
    expect(mayVisit("OPERATOR", "/")).toBe(true);
  });
});

describe("nav and the route table agree", () => {
  // The sidebar is only a reflection of this table. If a nav item is offered
  // to a tenant type the middleware would bounce, the user gets a link that
  // redirects — which is how a screen ends up quietly unreachable.
  it("never offers a link its own tenant type cannot open", () => {
    const types = ["OPERATOR", "PARTNER_AGENT", "CUSTOMER"] as const;
    for (const item of NAV_ITEMS) {
      for (const type of types) {
        const offered = !item.visibleTo || item.visibleTo.includes(type);
        if (offered) {
          expect({ href: item.href, type, allowed: mayVisit(type, item.href) }).toEqual({
            href: item.href,
            type,
            allowed: true,
          });
        }
      }
    }
  });
});

describe("homeFor", () => {
  it("sends each tenant type somewhere it is allowed to be", () => {
    for (const type of ["OPERATOR", "PARTNER_AGENT", "CUSTOMER"] as const) {
      expect(mayVisit(type, homeFor(type))).toBe(true);
    }
  });
});
