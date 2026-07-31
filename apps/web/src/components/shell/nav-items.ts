import type { TenantType } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  group: string;
  /** Omit to show for every tenant type. */
  visibleTo?: TenantType[];
}

const OPERATIONAL: TenantType[] = ["OPERATOR", "PARTNER_AGENT"];

export const NAV_ITEMS: NavItem[] = [
  // A customer landing on `/` is sent straight to `/track`, so offering them
  // the link would be offering a link that bounces.
  { href: "/", label: "Dashboard", group: "Overview", visibleTo: OPERATIONAL },
  { href: "/system", label: "System Monitor", group: "Overview", visibleTo: OPERATIONAL },

  // A customer sees its own cargo and its own invoices, and nothing else —
  // these read the portal endpoints, which scope by linked party rather than
  // by tenant. Every operational screen below is hidden from them, and the
  // API refuses them regardless of what the nav shows.
  { href: "/track", label: "My Shipments", group: "Overview", visibleTo: ["CUSTOMER"] },
  { href: "/track/invoices", label: "My Invoices", group: "Overview", visibleTo: ["CUSTOMER"] },

  { href: "/quotes/new", label: "New Quote", group: "Commercial", visibleTo: OPERATIONAL },
  { href: "/shipments", label: "Shipments", group: "Commercial", visibleTo: OPERATIONAL },
  { href: "/ops", label: "Ops Console", group: "Commercial", visibleTo: OPERATIONAL },

  { href: "/customs", label: "Customs", group: "Compliance", visibleTo: OPERATIONAL },
  { href: "/documents", label: "Documents", group: "Compliance", visibleTo: OPERATIONAL },
  { href: "/parties", label: "Parties", group: "Compliance", visibleTo: OPERATIONAL },

  { href: "/invoices", label: "Invoices", group: "Finance", visibleTo: OPERATIONAL },
  { href: "/finance", label: "Finance Views", group: "Finance", visibleTo: OPERATIONAL },
  // Platform fees only mean something for a partner tenant — an operator
  // sees what partners owe via the Partners screen instead.
  { href: "/platform-fees", label: "Platform Fees", group: "Finance", visibleTo: ["PARTNER_AGENT"] },

  // M10: the infrastructure business — other operators running on our
  // rails, not our own shipments. Deliberately its own nav group so the
  // two business models (forwarder vs. platform) read as distinct in the
  // product, not just in a strategy doc.
  { href: "/partners", label: "Partners", group: "Infrastructure", visibleTo: ["OPERATOR"] },
  { href: "/network", label: "Network Overview", group: "Infrastructure", visibleTo: ["OPERATOR"] },
];

export function visibleNavItems(tenantType: TenantType | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.visibleTo || (tenantType && item.visibleTo.includes(tenantType)));
}
