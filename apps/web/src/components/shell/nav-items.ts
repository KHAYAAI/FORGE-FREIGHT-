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

  // M10: franchise layer, operator-only.
  { href: "/partners", label: "Partners", group: "Admin", visibleTo: ["OPERATOR"] },
];

export function visibleNavItems(tenantType: TenantType | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.visibleTo || (tenantType && item.visibleTo.includes(tenantType)));
}
