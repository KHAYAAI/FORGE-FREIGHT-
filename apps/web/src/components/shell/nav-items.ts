import type { TenantType } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  group: string;
  /** Omit to show for every tenant type. */
  visibleTo?: TenantType[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", group: "Overview" },
  { href: "/system", label: "System Monitor", group: "Overview" },

  { href: "/quotes/new", label: "New Quote", group: "Commercial" },
  { href: "/shipments", label: "Shipments", group: "Commercial" },
  { href: "/ops", label: "Ops Console", group: "Commercial" },

  { href: "/customs", label: "Customs", group: "Compliance" },
  { href: "/documents", label: "Documents", group: "Compliance" },
  { href: "/parties", label: "Parties", group: "Compliance" },

  { href: "/invoices", label: "Invoices", group: "Finance" },
  { href: "/finance", label: "Finance Views", group: "Finance" },
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
