export interface NavItem {
  href: string;
  label: string;
  group: string;
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
];
