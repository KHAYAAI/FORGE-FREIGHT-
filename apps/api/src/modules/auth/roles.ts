import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { CONFIG, type AppConfig } from "../../config.js";
import { AUTH_CONTEXT_KEY, type AuthContext } from "./auth.types.js";

/**
 * The roles a tenant's own users are divided into. Deliberately few: this is
 * separation of duty inside one freight business, not a permission matrix.
 *
 * - `admin`   — changes what the business *is*: prices, margins, partners, and
 *               which customer tenant may see which party's cargo.
 * - `finance` — money in and out: issuing invoices and recording payments.
 * - `ops`     — moving freight: quotes, bookings, customs, documents,
 *               exceptions. The default for everyone who does the day job.
 *
 * Reading is not gated by role. A forwarder is a small team; hiding the
 * shipment list from a colleague protects nobody and gets worked around with
 * a shared login, which is worse than the thing it was guarding against.
 */
export const ROLES = ["admin", "finance", "ops"] as const;
export type Role = (typeof ROLES)[number];

export const ROLES_KEY = "forgeRequiredRoles";

/**
 * Require any one of these roles. `admin` is accepted everywhere without
 * being listed — an administrator who cannot record a payment on a Friday
 * afternoon just borrows a finance login, and then the audit trail is a lie.
 */
export const RequireRoles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);
  private warned = false;

  // `Reflector` needs an explicit @Inject like every other dependency here:
  // tsx's esbuild transform drops `emitDecoratorMetadata`, so a constructor
  // parameter without one resolves to undefined at runtime rather than
  // failing at boot. It cost this guard a 500 on every request until a live
  // call found it — a hand-constructed unit test cannot see it.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const auth = (req as Request & Record<string, unknown>)[AUTH_CONTEXT_KEY] as
      | AuthContext
      | undefined;
    // No auth context means a public or machine-authenticated route reached
    // here; the JWT guard has already had its say.
    if (!auth) return true;

    if (auth.roles.includes("admin") || required.some((r) => auth.roles.includes(r))) {
      return true;
    }

    const message =
      `This action needs one of: ${required.join(", ")}. ` +
      (auth.roles.length === 0
        ? "The token carries no roles at all — the identity provider is probably missing a " +
          "realm-role mapper on the access token."
        : `This user has: ${auth.roles.join(", ")}.`);

    // An upgrade into a realm with no role mapper would lock every user out of
    // every write at once. `AUTH_ROLES=advisory` lets a deployment see exactly
    // which calls would be refused before it commits to enforcing them.
    if (this.cfg.AUTH_ROLES === "advisory") {
      if (!this.warned) {
        this.logger.warn(
          "AUTH_ROLES=advisory — role requirements are logged, not enforced. " +
            "Map realm roles in the identity provider, then set AUTH_ROLES=enforce.",
        );
        this.warned = true;
      }
      this.logger.warn(`Would refuse ${req.method} ${req.path}: ${message}`);
      return true;
    }

    throw new ForbiddenException(message);
  }
}
