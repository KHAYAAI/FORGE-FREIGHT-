"use client";

import { useRouter } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

export function Topbar({ tenantLabel, userId }: { tenantLabel: string; userId: string }) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-hairline bg-canvas px-6">
      <div className="flex items-center gap-2 text-[11.5px] text-tertiary">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Connected
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-sm border border-strong bg-raised px-2.5 py-1">
          <span className="text-[11px] font-medium text-secondary">{tenantLabel}</span>
          <span className="text-[10px] text-tertiary">·</span>
          <span className="font-mono text-[10.5px] text-tertiary">{userId}</span>
        </div>
        <ThemeToggle />
        <button
          onClick={signOut}
          className="h-7 rounded-sm px-2.5 text-[11px] font-medium text-secondary hover:text-critical"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
