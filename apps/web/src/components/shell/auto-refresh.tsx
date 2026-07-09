"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls the server component tree via router.refresh() — used on the system monitor. */
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
