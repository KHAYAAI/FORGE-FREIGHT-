/**
 * @vitest-environment node
 *
 * Auth runs server-side only. jsdom's globals live in a different realm from
 * Node's, which trips jose's `instanceof Uint8Array` checks — and jsdom is the
 * wrong environment for this code regardless.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuthConfig } from "@/lib/auth-config";
import {
  SessionTooLargeError,
  authHeaders,
  needsRefresh,
  openSession,
  sealSession,
  type Session,
} from "@/lib/session";

const ORIGINAL = { ...process.env };

function useOidc(secret = "s".repeat(40)) {
  process.env.AUTH_MODE = "oidc";
  process.env.AUTH_ISSUER = "https://sso.example.com/realms/ff";
  process.env.AUTH_CLIENT_ID = "forge-console";
  process.env.SESSION_SECRET = secret;
  resetAuthConfig();
}

function useDev() {
  for (const key of ["AUTH_MODE", "AUTH_ISSUER", "AUTH_CLIENT_ID", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  resetAuthConfig();
}

beforeEach(() => useDev());
afterEach(() => {
  process.env = { ...ORIGINAL };
  resetAuthConfig();
});

const oidcSession: Session = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  tenantLabel: "FORGE Freight",
  userId: "user-42",
  tenantType: "OPERATOR",
  mode: "oidc",
  tokens: { accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: 0 },
};

describe("sealed session", () => {
  it("round-trips", async () => {
    useOidc();
    const sealed = await sealSession(oidcSession, 3600);
    expect(await openSession(sealed)).toMatchObject({
      tenantId: oidcSession.tenantId,
      userId: "user-42",
      mode: "oidc",
    });
  });

  it("is opaque — the tokens are not readable from the cookie value", async () => {
    useOidc();
    const sealed = await sealSession(oidcSession, 3600);
    // A merely signed cookie would leave a working bearer token legible to
    // anything that can see the cookie: a proxy log, a browser extension.
    expect(sealed).not.toContain("access-token-value");
    expect(sealed).not.toContain("refresh-token-value");
    expect(Buffer.from(sealed, "base64").toString("utf8")).not.toContain("access-token-value");
  });

  it("rejects a cookie sealed with a different secret", async () => {
    useOidc("a".repeat(40));
    const sealed = await sealSession(oidcSession, 3600);
    useOidc("b".repeat(40));
    expect(await openSession(sealed)).toBeNull();
  });

  it("rejects a tampered cookie", async () => {
    useOidc();
    const sealed = await sealSession(oidcSession, 3600);
    const parts = sealed.split(".");
    parts[3] = parts[3]!.slice(0, -4) + "AAAA"; // corrupt the ciphertext
    expect(await openSession(parts.join("."))).toBeNull();
  });

  it("rejects an expired cookie", async () => {
    useOidc();
    const sealed = await sealSession(oidcSession, -10);
    expect(await openSession(sealed)).toBeNull();
  });

  it("refuses a dev cookie once the deployment moves to oidc", async () => {
    // Otherwise a cookie minted while the console was in dev mode would keep
    // authenticating after real auth was switched on.
    useDev();
    const devCookie = await sealSession(
      { tenantId: "t", tenantLabel: "t", userId: "dev", tenantType: "OPERATOR", mode: "dev" },
      3600,
    );
    useOidc();
    expect(await openSession(devCookie)).toBeNull();
  });

  it("refuses a cookie that carries no tenant type", async () => {
    // Cookies minted before the console routed by tenant type. Honouring one
    // would leave the middleware unable to decide which product to show, so
    // it is treated as no session at all.
    useOidc();
    const { tenantType: _dropped, ...legacy } = oidcSession;
    const sealed = await sealSession(legacy as Session, 3600);
    expect(await openSession(sealed)).toBeNull();
  });

  it("refuses an oidc cookie under dev mode", async () => {
    useOidc();
    const sealed = await sealSession(oidcSession, 3600);
    useDev();
    expect(await openSession(sealed)).toBeNull();
  });

  it("fails loudly rather than minting a cookie the browser will silently drop", async () => {
    useOidc();
    const bloated: Session = {
      ...oidcSession,
      tokens: { accessToken: "x".repeat(8000), refreshToken: null, expiresAt: 0 },
    };
    await expect(sealSession(bloated, 3600)).rejects.toBeInstanceOf(SessionTooLargeError);
  });
});

describe("needsRefresh", () => {
  const now = 1_800_000_000_000; // fixed clock, ms
  const nowSeconds = Math.floor(now / 1000);

  function withExpiry(expiresAt: number): Session {
    return { ...oidcSession, tokens: { ...oidcSession.tokens!, expiresAt } };
  }

  it("is false while the token has comfortable life left", () => {
    expect(needsRefresh(withExpiry(nowSeconds + 600), now)).toBe(false);
  });

  it("is true once expired", () => {
    expect(needsRefresh(withExpiry(nowSeconds - 1), now)).toBe(true);
  });

  it("refreshes ahead of expiry rather than racing it", () => {
    // A token with 30s left would expire in flight on a slow API call.
    expect(needsRefresh(withExpiry(nowSeconds + 30), now)).toBe(true);
  });

  it("never refreshes a dev session", () => {
    expect(needsRefresh({ tenantId: "t", tenantLabel: "t", userId: "dev", tenantType: "OPERATOR", mode: "dev" }, now)).toBe(
      false,
    );
  });
});

describe("authHeaders", () => {
  it("sends a bearer token under oidc", () => {
    expect(authHeaders(oidcSession)).toEqual({ authorization: "Bearer access-token-value" });
  });

  it("sends dev headers in dev mode", () => {
    expect(
      authHeaders({ tenantId: "tenant-1", tenantLabel: "t", userId: "dev", tenantType: "OPERATOR", mode: "dev" }),
    ).toEqual({ "x-dev-tenant-id": "tenant-1", "x-dev-user-id": "dev" });
  });

  it("never sends dev headers for an oidc session", () => {
    // The API's dev guard is disabled in production, but sending both would
    // mean the console's intent depends on the API's configuration.
    expect(authHeaders(oidcSession)).not.toHaveProperty("x-dev-tenant-id");
  });

  it("sends nothing without a session", () => {
    expect(authHeaders(null)).toEqual({});
  });
});
