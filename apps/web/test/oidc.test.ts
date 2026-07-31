/**
 * @vitest-environment node
 *
 * Auth runs server-side only. jsdom's globals live in a different realm from
 * Node's, which trips jose's `instanceof Uint8Array` checks — and jsdom is the
 * wrong environment for this code regardless.
 */
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAuthConfig, type OidcConfig } from "@/lib/auth-config";
import {
  authorizationUrl,
  codeChallenge,
  conventionalEndpoints,
  discover,
  endSessionUrl,
  exchangeCode,
  MissingTenantClaimError,
  OidcError,
  randomToken,
  sessionFromTokens,
  toSessionTokens,
} from "@/lib/oidc";
import { safeNextPath, parseFlowState } from "@/lib/auth-flow";

const cfg = readAuthConfig({
  AUTH_MODE: "oidc",
  AUTH_ISSUER: "https://sso.example.com/realms/ff",
  AUTH_CLIENT_ID: "forge-console",
  SESSION_SECRET: "x".repeat(32),
}) as OidcConfig;

const endpoints = conventionalEndpoints(cfg.issuer);
const secret = new TextEncoder().encode("test-signing-key-at-least-32-bytes!!");

async function accessToken(claims: Record<string, unknown>, expSeconds?: number) {
  let jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(
    (claims.sub as string) ?? "user-1",
  );
  if (expSeconds !== undefined) jwt = jwt.setExpirationTime(expSeconds);
  return jwt.sign(secret);
}

describe("PKCE", () => {
  it("produces a URL-safe verifier and its S256 challenge", async () => {
    const verifier = randomToken(48);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(verifier)).toBe(verifier);

    const challenge = await codeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url SHA-256, unpadded
    expect(challenge).not.toBe(verifier);
    // Deterministic for a given verifier — the callback recomputes it.
    expect(await codeChallenge(verifier)).toBe(challenge);
  });

  it("matches the RFC 7636 test vector", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("mints a different verifier every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(seen.size).toBe(50);
  });
});

describe("authorization URL", () => {
  it("carries the PKCE challenge, state, and openid scope", async () => {
    const url = new URL(
      await authorizationUrl({
        cfg,
        endpoints,
        redirectUri: "https://console.example.com/api/auth/callback",
        state: "state-123",
        verifier: "verifier-abc",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${cfg.issuer}/protocol/openid-connect/auth`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await codeChallenge("verifier-abc"));
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")?.split(" ")).toContain("openid");
    // The verifier itself must never leave the server.
    expect(url.toString()).not.toContain("verifier-abc");
  });

  it("de-duplicates configured scopes against the defaults", async () => {
    const withDupes = { ...cfg, scopes: ["openid", "roles"] };
    const url = new URL(
      await authorizationUrl({
        cfg: withDupes,
        endpoints,
        redirectUri: "https://c/cb",
        state: "s",
        verifier: "v",
      }),
    );
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes.filter((s) => s === "openid")).toHaveLength(1);
    expect(scopes).toContain("roles");
  });
});

describe("discovery", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("falls back to Keycloak's conventional paths when discovery is unreachable", async () => {
    // A Keycloak blip must not lock every user out of a console whose
    // endpoints have not actually moved.
    const failing = vi.fn().mockRejectedValue(new Error("connection refused"));
    const resolved = await discover({ ...cfg, issuer: "https://down.example/realms/x" }, failing);
    expect(resolved.token).toBe("https://down.example/realms/x/protocol/openid-connect/token");
  });

  it("prefers the discovery document when it is available", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: "https://sso.example.com/custom/auth",
        token_endpoint: "https://sso.example.com/custom/token",
      }),
    });
    const resolved = await discover({ ...cfg, issuer: "https://fresh.example/realms/y" }, fetchImpl as never);
    expect(resolved.token).toBe("https://sso.example.com/custom/token");
  });
});

describe("code exchange", () => {
  it("posts the verifier and client id, and never the challenge", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 300 }),
    });

    await exchangeCode({
      cfg,
      endpoints,
      code: "auth-code",
      redirectUri: "https://console.example.com/api/auth/callback",
      verifier: "verifier-abc",
      fetchImpl: fetchImpl as never,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier-abc");
    expect(body.get("client_id")).toBe("forge-console");
    expect(body.get("client_secret")).toBeNull(); // public client
  });

  it("surfaces the provider's error code without echoing the request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant", error_description: "code expired" }),
    });

    const err = await exchangeCode({
      cfg,
      endpoints,
      code: "stale",
      redirectUri: "https://c/cb",
      verifier: "v",
      fetchImpl: fetchImpl as never,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OidcError);
    expect((err as Error).message).toContain("invalid_grant");
    expect((err as Error).message).not.toContain("stale");
  });
});

describe("session from tokens", () => {
  it("reads tenant and subject from the access token", async () => {
    const token = await accessToken({
      tenant_id: "11111111-1111-1111-1111-111111111111",
      sub: "user-42",
      preferred_username: "ops@forge",
    });
    const session = sessionFromTokens(cfg, { access_token: token, refresh_token: "rt" });
    expect(session.tenantId).toBe("11111111-1111-1111-1111-111111111111");
    expect(session.userId).toBe("user-42");
    expect(session.mode).toBe("oidc");
    expect(session.tokens?.refreshToken).toBe("rt");
  });

  it("explains itself when the realm has no tenant mapper", async () => {
    // The single most likely setup mistake — a bare error here would send an
    // operator hunting through the console instead of Keycloak.
    const token = await accessToken({ sub: "user-42" });
    const err = await Promise.resolve()
      .then(() => sessionFromTokens(cfg, { access_token: token }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingTenantClaimError);
    expect((err as Error).message).toContain("tenant_id");
  });

  it("honours a custom tenant claim name", async () => {
    const token = await accessToken({ org: "tenant-9", sub: "u" });
    const session = sessionFromTokens({ ...cfg, tenantClaim: "org" }, { access_token: token });
    expect(session.tenantId).toBe("tenant-9");
  });

  it("prefers the token's own exp over the relative expires_in", async () => {
    // expires_in is relative to the issuer's clock, which we don't share.
    const exp = Math.floor(Date.now() / 1000) + 1234;
    const token = await accessToken({ tenant_id: "t", sub: "u" }, exp);
    const session = sessionFromTokens(cfg, { access_token: token, expires_in: 30 });
    expect(session.tokens?.expiresAt).toBe(exp);
  });

  it("falls back to expires_in when the token carries no exp", () => {
    const before = Math.floor(Date.now() / 1000);
    const tokens = toSessionTokens({ access_token: "opaque", expires_in: 600 });
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 600);
  });
});

describe("logout", () => {
  it("asks the provider to end its own session too", () => {
    const url = endSessionUrl({
      endpoints,
      idToken: null,
      redirectUri: "https://console.example.com/login",
      clientId: cfg.clientId,
    });
    expect(url).toContain("/protocol/openid-connect/logout");
    expect(url).toContain("post_logout_redirect_uri=");
    expect(url).toContain("client_id=forge-console");
  });

  it("returns null when the provider advertises no end-session endpoint", () => {
    expect(
      endSessionUrl({
        endpoints: { ...endpoints, endSession: null },
        idToken: null,
        redirectUri: "https://c/login",
        clientId: "x",
      }),
    ).toBeNull();
  });
});

describe("post-login redirect", () => {
  it.each([
    ["https://evil.example/pwn", "/"],
    ["//evil.example/pwn", "/"],
    ["http://evil.example", "/"],
    [null, "/"],
    ["", "/"],
  ])("refuses to bounce to %s", (input, expected) => {
    // Open-redirect guard: the user really did authenticate, so a redirect
    // off-site lands them on an attacker's page still believing it's ours.
    expect(safeNextPath(input)).toBe(expected);
  });

  it("keeps a same-site path with its query", () => {
    expect(safeNextPath("/shipments?status=CUSTOMS")).toBe("/shipments?status=CUSTOMS");
  });
});

describe("flow state", () => {
  it("round-trips", () => {
    const parsed = parseFlowState(JSON.stringify({ state: "s", verifier: "v", next: "/ops" }));
    expect(parsed).toEqual({ state: "s", verifier: "v", next: "/ops" });
  });

  it.each([
    ["missing", undefined],
    ["not json", "{{{"],
    ["without a verifier", JSON.stringify({ state: "s" })],
    ["without a state", JSON.stringify({ verifier: "v" })],
  ])("rejects a %s flow cookie", (_label, raw) => {
    expect(parseFlowState(raw)).toBeNull();
  });

  it("sanitises the redirect carried through the flow", () => {
    const parsed = parseFlowState(
      JSON.stringify({ state: "s", verifier: "v", next: "https://evil.example" }),
    );
    expect(parsed?.next).toBe("/");
  });
});
