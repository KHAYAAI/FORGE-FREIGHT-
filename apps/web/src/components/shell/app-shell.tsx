import type { ReactNode } from "react";
import type { Session } from "@/lib/session";
import type { TenantType } from "@/lib/types";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  session,
  tenantType,
  children,
}: {
  session: Session;
  tenantType?: TenantType;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar tenantType={tenantType} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar tenantLabel={session.tenantLabel} userId={session.userId} />
        <main className="flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
