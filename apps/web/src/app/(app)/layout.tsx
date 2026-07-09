import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  // Belt-and-braces — middleware already redirects unauthenticated requests.
  if (!session) redirect("/login");
  return <AppShell session={session}>{children}</AppShell>;
}
