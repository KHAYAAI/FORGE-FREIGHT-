import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { api } from "@/lib/api";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  // Belt-and-braces — middleware already redirects unauthenticated requests.
  if (!session) redirect("/login");

  const tenant = await api.getMyTenant().catch(() => null);

  return (
    <AppShell session={session} tenantType={tenant?.type}>
      {children}
    </AppShell>
  );
}
