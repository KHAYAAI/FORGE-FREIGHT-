import { Suspense } from "react";
import { authConfig } from "@/lib/auth-config";
import { safeNextPath } from "@/lib/auth-flow";
import { DevLoginForm } from "@/components/forms/dev-login-form";

export const dynamic = "force-dynamic";

/**
 * Human-readable rendering of the `error` query parameter the auth routes and
 * middleware set. Anything unrecognised is shown verbatim — the OIDC layer
 * puts genuinely useful configuration messages there (a missing tenant claim
 * mapper, most often) and swallowing them would make setup guesswork.
 */
function describeError(code: string): string {
  switch (code) {
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "state_mismatch":
      return "Sign-in could not be verified. Start again from this page.";
    case "expired":
      return "Sign-in took too long and the request expired. Try again.";
    case "no_code":
    case "exchange_failed":
      return "The identity provider did not complete sign-in. Try again.";
    case "access_denied":
      return "Sign-in was cancelled.";
    case "not_configured":
      return "Single sign-on is not configured on this deployment.";
    default:
      return code;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const cfg = authConfig();
  const target = safeNextPath(next);

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

        {error && (
          <div className="mb-4 rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2 text-[12px] text-critical">
            {describeError(error)}
          </div>
        )}

        {cfg.mode === "oidc" ? (
          <div className="rounded border border-hairline bg-surface p-6 shadow-[var(--shadow-panel)]">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-accent">
              Session
            </div>
            <h1 className="mb-2 text-[16px] font-semibold text-primary">Sign in to the console</h1>
            <p className="mb-5 text-[12px] text-secondary">
              Authentication is handled by your organisation&apos;s identity provider. Your tenant
              and permissions come from the token it issues.
            </p>
            <a
              href={`/api/auth/login?next=${encodeURIComponent(target)}`}
              className="flex h-10 w-full items-center justify-center rounded-sm bg-accent text-[13px] font-medium text-white transition-colors hover:bg-accent-strong"
            >
              Continue with single sign-on
            </a>
          </div>
        ) : (
          <Suspense>
            <DevLoginForm />
          </Suspense>
        )}

        <p className="mt-4 text-center text-[11px] text-tertiary">
          {cfg.mode === "oidc"
            ? "Single sign-on (AUTH_MODE=oidc)."
            : "Dev-mode session (AUTH_MODE=dev) — no credential is checked. Production authenticates via Keycloak."}
        </p>
      </div>
    </div>
  );
}
