import { ThemeToggle } from "./theme-toggle";

export function Topbar({ tenantLabel, userId }: { tenantLabel: string; userId: string }) {
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
        {/*
          A link, not a fetch: under OIDC the route redirects on to Keycloak's
          end-session endpoint so signing out here also ends the session at the
          identity provider, rather than leaving one click between a shared
          machine and the console.
        */}
        <a
          href="/api/auth/logout"
          className="flex h-7 items-center rounded-sm px-2.5 text-[11px] font-medium text-secondary hover:text-critical"
        >
          Sign out
        </a>
      </div>
    </header>
  );
}
