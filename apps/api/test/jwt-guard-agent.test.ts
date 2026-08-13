import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AUTH_CONTEXT_KEY } from "../src/modules/auth/auth.types.js";
import { JwtAuthGuard } from "../src/modules/auth/jwt.guard.js";
import type { AppConfig } from "../src/config.js";

/**
 * freight-mcp's only route into the API. Unlike IngestKeyGuard, an unset
 * AGENT_API_KEY must mean "this path never activates," not "let it through" —
 * these are general tenant-data reads, not a dedicated machine-only prefix.
 * That asymmetry is the thing most worth a wrong-default bug, so it gets its
 * own coverage rather than trusting the ingest-key precedent to generalise.
 */
function ctx(headers: Record<string, string | undefined>, path = "/shipments/x") {
  const req: Record<string, unknown> = {
    path,
    header: (name: string) => headers[name.toLowerCase()],
  };
  return {
    req,
    host: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

const cfg = (over: Partial<AppConfig> = {}) =>
  ({ AUTH_MODE: "jwt", AGENT_API_KEY: "", ...over }) as AppConfig;

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("JwtAuthGuard — agent key path", () => {
  it("ignores x-agent-key entirely when AGENT_API_KEY is unset", async () => {
    const { host } = ctx({ "x-agent-key": "anything" });
    const guard = new JwtAuthGuard(cfg({ AGENT_API_KEY: "" }), null);
    // Falls through to the Bearer check, which has nothing to work with.
    await expect(guard.canActivate(host)).rejects.toThrow(UnauthorizedException);
  });

  it("admits a correct key with a valid tenant id", async () => {
    const { req, host } = ctx({
      "x-agent-key": "correct-horse-battery-staple",
      "x-agent-tenant-id": TENANT,
      "x-agent-id": "hermes",
    });
    const guard = new JwtAuthGuard(cfg({ AGENT_API_KEY: "correct-horse-battery-staple" }), null);
    await expect(guard.canActivate(host)).resolves.toBe(true);

    const auth = req[AUTH_CONTEXT_KEY] as { tenantId: string; userId: string; roles: string[] };
    expect(auth.tenantId).toBe(TENANT);
    expect(auth.userId).toBe("agent:hermes");
    expect(auth.roles).toEqual(["ops"]);
  });

  it("refuses a wrong key outright, without falling through to Bearer", async () => {
    const { host } = ctx({
      "x-agent-key": "wrong",
      "x-agent-tenant-id": TENANT,
    });
    const guard = new JwtAuthGuard(cfg({ AGENT_API_KEY: "correct-horse-battery-staple" }), null);
    await expect(guard.canActivate(host)).rejects.toThrow("Invalid agent API key");
  });

  it("refuses a correct key with no tenant id", async () => {
    const { host } = ctx({ "x-agent-key": "k" });
    const guard = new JwtAuthGuard(cfg({ AGENT_API_KEY: "k" }), null);
    await expect(guard.canActivate(host)).rejects.toThrow(/x-agent-tenant-id/);
  });

  it("refuses a correct key with a malformed tenant id", async () => {
    const { host } = ctx({ "x-agent-key": "k", "x-agent-tenant-id": "not-a-uuid" });
    const guard = new JwtAuthGuard(cfg({ AGENT_API_KEY: "k" }), null);
    await expect(guard.canActivate(host)).rejects.toThrow(/uuid/);
  });

  it("never grants admin or finance — only what the read-only tool surface needs", async () => {
    const { req, host } = ctx({ "x-agent-key": "k", "x-agent-tenant-id": TENANT });
    const guard = new JwtAuthGuard(cfg({ AGENT_API_KEY: "k" }), null);
    await guard.canActivate(host);
    const auth = req[AUTH_CONTEXT_KEY] as { roles: string[] };
    expect(auth.roles).not.toContain("admin");
    expect(auth.roles).not.toContain("finance");
  });

  it("leaves normal dev-mode auth untouched when no agent header is sent", async () => {
    const { req, host } = ctx({ "x-dev-tenant-id": TENANT });
    const guard = new JwtAuthGuard(cfg({ AUTH_MODE: "dev", AGENT_API_KEY: "k" }), null);
    await expect(guard.canActivate(host)).resolves.toBe(true);
    expect((req[AUTH_CONTEXT_KEY] as { tenantId: string }).tenantId).toBe(TENANT);
  });

  it("does not activate on /ingest/ or /scheduled/ — those stay on their own guards", async () => {
    const { host: ingestHost } = ctx(
      { "x-agent-key": "k" },
      "/ingest/rfq",
    );
    const guard = new JwtAuthGuard(cfg({ AGENT_API_KEY: "k" }), null);
    // Bypassed before the agent check is ever reached.
    await expect(guard.canActivate(ingestHost)).resolves.toBe(true);
  });
});
