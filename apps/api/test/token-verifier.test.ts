import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  TokenVerificationError,
  TokenVerifier,
} from "../src/modules/auth/token-verifier.js";

const ISSUER = "http://localhost:8080/realms/forge-freight";
const TENANT = "994a0c36-792d-43d5-93e6-6d0078f7b295";

let signKey: CryptoKey;
let verifier: TokenVerifier;

async function makeToken(
  claims: Record<string, unknown>,
  opts: { expired?: boolean; issuer?: string } = {},
) {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(opts.issuer ?? ISSUER)
    .setSubject("user-123")
    .setIssuedAt();
  jwt = opts.expired ? jwt.setExpirationTime("-1h") : jwt.setExpirationTime("1h");
  return jwt.sign(signKey);
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  signKey = privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  verifier = new TokenVerifier(
    { AUTH_ISSUER: ISSUER, AUTH_AUDIENCE: undefined, AUTH_TENANT_CLAIM: "tenant_id" },
    jwks,
  );
});

describe("TokenVerifier", () => {
  it("extracts tenant, user, and realm roles from a valid token", async () => {
    const token = await makeToken({
      tenant_id: TENANT,
      realm_access: { roles: ["ops", "admin"] },
    });
    const auth = await verifier.verify(token);
    expect(auth).toEqual({
      tenantId: TENANT,
      userId: "user-123",
      roles: ["ops", "admin"],
    });
  });

  it("rejects expired tokens", async () => {
    const token = await makeToken({ tenant_id: TENANT }, { expired: true });
    await expect(verifier.verify(token)).rejects.toThrow(TokenVerificationError);
  });

  it("rejects tokens from the wrong issuer", async () => {
    const token = await makeToken(
      { tenant_id: TENANT },
      { issuer: "http://evil.example/realms/other" },
    );
    await expect(verifier.verify(token)).rejects.toThrow(TokenVerificationError);
  });

  it("rejects tokens missing the tenant claim", async () => {
    const token = await makeToken({ realm_access: { roles: ["ops"] } });
    await expect(verifier.verify(token)).rejects.toThrow(/tenant_id/);
  });

  it("rejects a tenant claim that is not a uuid", async () => {
    // Otherwise the value reaches the query layer and Postgres turns a bad
    // credential into a 500.
    const token = await makeToken({ tenant_id: "acme-corp" });
    await expect(verifier.verify(token)).rejects.toThrow(/must be a tenant uuid/);
  });

  it("rejects garbage tokens", async () => {
    await expect(verifier.verify("not.a.jwt")).rejects.toThrow(TokenVerificationError);
  });
});
