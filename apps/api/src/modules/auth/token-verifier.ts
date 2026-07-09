import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import type { AppConfig } from "../../config.js";
import type { AuthContext } from "./auth.types.js";

export class TokenVerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenVerificationError";
  }
}

/**
 * Verifies Keycloak-issued JWTs and extracts the FORGE Freight AuthContext.
 * The key source is injectable so tests can use a local JWKS instead of a
 * live Keycloak.
 */
export class TokenVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(
    private readonly cfg: Pick<
      AppConfig,
      "AUTH_ISSUER" | "AUTH_AUDIENCE" | "AUTH_TENANT_CLAIM"
    >,
    getKey?: JWTVerifyGetKey,
    jwksUrl?: string | null,
  ) {
    if (getKey) {
      this.getKey = getKey;
    } else {
      if (!jwksUrl) throw new Error("TokenVerifier requires a JWKS URL or key getter");
      this.getKey = createRemoteJWKSet(new URL(jwksUrl));
    }
  }

  async verify(token: string): Promise<AuthContext> {
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, this.getKey, {
        issuer: this.cfg.AUTH_ISSUER,
        audience: this.cfg.AUTH_AUDIENCE,
      });
      payload = result.payload;
    } catch (err) {
      throw new TokenVerificationError("Invalid or expired token", { cause: err });
    }

    const tenantId = payload[this.cfg.AUTH_TENANT_CLAIM];
    if (typeof tenantId !== "string" || tenantId.length === 0) {
      throw new TokenVerificationError(
        `Token is missing the '${this.cfg.AUTH_TENANT_CLAIM}' claim`,
      );
    }
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new TokenVerificationError("Token is missing the 'sub' claim");
    }

    // Keycloak realm roles live at realm_access.roles.
    const realmAccess = payload["realm_access"] as { roles?: unknown } | undefined;
    const roles = Array.isArray(realmAccess?.roles)
      ? realmAccess.roles.filter((r): r is string => typeof r === "string")
      : [];

    return { tenantId, userId: payload.sub, roles };
  }
}
