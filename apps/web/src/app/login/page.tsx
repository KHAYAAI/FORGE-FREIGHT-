"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [tenantId, setTenantId] = useState("");
  const [tenantLabel, setTenantLabel] = useState("FORGE Freight — Operator");
  const [userId, setUserId] = useState("dev");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tenantId.trim()) {
      setError("Tenant ID is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: tenantId.trim(), tenantLabel: tenantLabel.trim(), userId: userId.trim() || "dev" }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push(params.get("next") ?? "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-accent text-[13px] font-bold text-white">
            F
          </div>
          <div>
            <div className="text-[14px] font-semibold leading-none text-primary">FORGE</div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary">
              Freight OS
            </div>
          </div>
        </div>

        <div className="rounded border border-hairline bg-surface p-6 shadow-[var(--shadow-panel)]">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-accent">
            Session
          </div>
          <h1 className="mb-5 text-[16px] font-semibold text-primary">Sign in to the console</h1>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field
              label="Tenant ID"
              required
              hint="UUID printed by `pnpm db:seed` as `operator`, or from docker compose logs."
            >
              <Input
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono text-[12px]"
                autoFocus
              />
            </Field>
            <Field label="Tenant label" hint="Display name only — cosmetic.">
              <Input value={tenantLabel} onChange={(e) => setTenantLabel(e.target.value)} />
            </Field>
            <Field label="User ID" hint="Actor recorded on events you create.">
              <Input value={userId} onChange={(e) => setUserId(e.target.value)} />
            </Field>

            {error && (
              <div className="rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2 text-[12px] text-critical">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" disabled={busy} className="mt-1">
              {busy ? "Signing in…" : "Enter console"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-tertiary">
          Dev-mode session (AUTH_MODE=dev). Production authenticates via Keycloak.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
