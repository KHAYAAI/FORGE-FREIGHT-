import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { AUTH_CONTEXT_KEY } from "../src/modules/auth/auth.types.js";
import { ROLES_KEY, RolesGuard } from "../src/modules/auth/roles.js";
import type { AppConfig } from "../src/config.js";

/**
 * `AuthContext.roles` was parsed off the token from the start and then never
 * read by anything, so every authenticated user could reprice a lane or record
 * a payment. These cover the guard that closed that.
 */
function ctx(roles: string[], required?: string[]) {
  const req: Record<string, unknown> = {
    method: "POST",
    path: "/rates/cards",
    [AUTH_CONTEXT_KEY]: { tenantId: "t", userId: "u", roles },
  };
  const reflector = new Reflector();
  vi.spyOn(reflector, "getAllAndOverride").mockReturnValue(required);
  return {
    reflector,
    host: {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

const cfg = (mode: "enforce" | "advisory") => ({ AUTH_ROLES: mode }) as AppConfig;

describe("RolesGuard", () => {
  it("lets a route with no requirement through", () => {
    const { reflector, host } = ctx([], undefined);
    expect(new RolesGuard(reflector, cfg("enforce")).canActivate(host)).toBe(true);
  });

  it("admits a user holding the required role", () => {
    const { reflector, host } = ctx(["ops", "finance"], ["finance"]);
    expect(new RolesGuard(reflector, cfg("enforce")).canActivate(host)).toBe(true);
  });

  it("refuses a user who does not", () => {
    const { reflector, host } = ctx(["ops"], ["admin"]);
    expect(() => new RolesGuard(reflector, cfg("enforce")).canActivate(host)).toThrow(
      ForbiddenException,
    );
  });

  it("admits an admin anywhere without listing it", () => {
    // An administrator who cannot record a payment on a Friday afternoon
    // borrows a finance login, and then the audit trail is a lie.
    const { reflector, host } = ctx(["admin"], ["finance"]);
    expect(new RolesGuard(reflector, cfg("enforce")).canActivate(host)).toBe(true);
  });

  it("names the missing mapper when the token carries no roles at all", () => {
    const { reflector, host } = ctx([], ["admin"]);
    expect(() => new RolesGuard(reflector, cfg("enforce")).canActivate(host)).toThrow(
      /realm-role mapper/,
    );
  });

  it("logs instead of refusing under AUTH_ROLES=advisory", () => {
    // The upgrade path: a deployment whose realm has no role mapper yet would
    // otherwise lose every write at once the moment this shipped.
    const { reflector, host } = ctx(["ops"], ["admin"]);
    expect(new RolesGuard(reflector, cfg("advisory")).canActivate(host)).toBe(true);
  });

  it("does not gate a route the JWT guard left unauthenticated", () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue(["admin"]);
    const host = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ method: "POST", path: "/ingest/dcsa" }) }),
    } as unknown as ExecutionContext;
    expect(new RolesGuard(reflector, cfg("enforce")).canActivate(host)).toBe(true);
  });
});

describe("ROLES_KEY", () => {
  it("is the key the decorator and the guard both use", () => {
    expect(ROLES_KEY).toBe("forgeRequiredRoles");
  });
});
