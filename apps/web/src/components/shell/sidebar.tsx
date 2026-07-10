"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { TenantType } from "@/lib/types";
import { visibleNavItems, type NavItem } from "./nav-items";

function groupItems(items: NavItem[]) {
  const groups = new Map<string, NavItem[]>();
  for (const item of items) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
  return groups;
}

export function Sidebar({ tenantType }: { tenantType?: TenantType }) {
  const pathname = usePathname();
  const groups = groupItems(visibleNavItems(tenantType));

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-hairline bg-surface">
      <div className="flex h-14 shrink-0 items-center border-b border-hairline px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent text-[11px] font-bold text-white">
            F
          </div>
          <div>
            <div className="text-[12.5px] font-semibold leading-none tracking-wide text-primary">
              FORGE
            </div>
            <div className="text-[9.5px] font-medium uppercase tracking-widest text-tertiary">
              Freight OS
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        {Array.from(groups.entries()).map(([group, items]) => (
          <div key={group} className="mb-5 px-3">
            <div className="mb-1.5 px-2 text-[9.5px] font-semibold uppercase tracking-widest text-tertiary">
              {group}
            </div>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-sm px-2 py-1.5 text-[12.5px] font-medium transition-colors",
                      active
                        ? "bg-accent-wash text-accent-strong"
                        : "text-secondary hover:bg-hover hover:text-primary",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
