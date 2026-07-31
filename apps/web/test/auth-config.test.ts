/**
 * @vitest-environment node
 *
 * Auth runs server-side only. jsdom's globals live in a different realm from
 * Node's, which trips jose's `instanceof Uint8Array` checks — and jsdom is the
 * wrong environment for this code regardless.
 */
import { describe, expect, it } from "vitest";
import { AuthConfigError, readAuthConfig } from "@/lib/auth-config";

const OIDC_ENV = {
  AUTH_MODE: "oidc",
  AUTH_ISSUER: "https://sso.example.com/realms/forge-freight",
  AUTH_CLIENT_ID: "forge-console",
  SESSION_SECRET: "x".repeat(32),
};

describe("auth mode resolution", () => {
  it("defaults to dev when nothing is configured", () => {
    expect(readAuthConfig({}).mode).toBe("dev");
  });

  it("defaults to oidc as soon as an issuer exists", () => {
    // The failure this ordering prevents: a deploy that sets up Keycloak but
    // forgets AUTH_MODE, and silently keeps trusting x-dev-* headers.
    const cfg = readAuthConfig({ ...OIDC_ENV, AUTH_MODE: undefined });
    expect(cfg.mode).toBe("oidc");
  });

  it("accepts the API's spelling of the same mode", () => {
    // apps/api calls it AUTH_MODE=jwt; one env file drives both services.
    expect(readAuthConfig({ ...OIDC_ENV, AUTH_MODE: "jwt" }).mode).toBe("oidc");
  });

  it("refuses dev mode in production", () => {
    expect(() =>
      readAuthConfig({ AUTH_MODE: "dev", NODE_ENV: "production" }),
    ).toThrow(AuthConfigError);
  });

  it("rejects an unknown mode rather than guessing", () => {
    expect(() => readAuthConfig({ AUTH_MODE: "basic" })).toThrow(
      AuthConfigError,
    );
  });
});

describe("oidc configuration", () => {
  it("reads a complete configuration", () => {
    const cfg = readAuthConfig(OIDC_ENV);
    if (cfg.mode !== "oidc") throw new Error("expected oidc");
    expect(cfg.issuer).toBe("https://sso.example.com/realms/forge-freight");
    expect(cfg.clientId).toBe("forge-console");
    expect(cfg.clientSecret).toBeNull(); // public client — PKCE carries the proof
    expect(cfg.tenantClaim).toBe("tenant_id");
  });

  it("strips a trailing slash from the issuer so endpoint URLs don't double up", () => {
    const cfg = readAuthConfig({ ...OIDC_ENV, AUTH_ISSUER: "https://sso.example.com/realms/ff/" });
    if (cfg.mode !== "oidc") throw new Error("expected oidc");
    expect(cfg.issuer).toBe("https://sso.example.com/realms/ff");
  });

  it.each([
    ["issuer", { AUTH_ISSUER: "" }],
    ["client id", { AUTH_CLIENT_ID: "" }],
    ["session secret", { SESSION_SECRET: "" }],
  ])("refuses to start without a %s", (_label, override) => {
    expect(() => readAuthConfig({ ...OIDC_ENV, ...override })).toThrow(AuthConfigError);
  });

  it("rejects a session secret too short to be worth encrypting with", () => {
    expect(() => readAuthConfig({ ...OIDC_ENV, SESSION_SECRET: "short" })).toThrow(AuthConfigError);
  });

  it("parses extra scopes from either separator", () => {
    const cfg = readAuthConfig({ ...OIDC_ENV, AUTH_SCOPES: "roles, offline_access" });
    if (cfg.mode !== "oidc") throw new Error("expected oidc");
    expect(cfg.scopes).toEqual(["roles", "offline_access"]);
  });
});
