import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { CONFIG, type AppConfig } from "../../config.js";
import { AUTH_CONTEXT_KEY, isTenantId, type AuthContext } from "./auth.types.js";
import { TokenVerifier } from "./token-verifier.js";

export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");

const PUBLIC_PATHS = new Set(["/health", "/health/ready"]);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (PUBLIC_PATHS.has(req.path)) return true;
    // Tracking webhooks authenticate machine-to-machine via IngestKeyGuard.
    if (req.path.startsWith("/ingest/")) return true;
    // Scheduled sweeps (Kestra) authenticate the same way. Kept as its own
    // prefix rather than folded into /ingest so that "what may a scheduler
    // call" stays answerable by reading the routes.
    if (req.path.startsWith("/scheduled/")) return true;

    // freight-mcp: a read-only agent, bound to exactly one tenant by its own
    // config (FREIGHT_MCP_TENANT_ID) — the same "one instance per tenant"
    // shape n8n already uses, so a malformed or hostile tool call cannot read
    // across tenants. Opt-in only: if AGENT_API_KEY is unset the header is
    // ignored and the request falls through to the normal auth below, rather
    // than IngestKeyGuard's fail-open-when-unset — these are general
    // tenant-data routes, not a dedicated machine-only prefix, so silence
    // must mean "not authenticated," never "let it through."
    const agentKey = req.header("x-agent-key");
    if (agentKey && this.cfg.AGENT_API_KEY) {
      const expected = this.cfg.AGENT_API_KEY;
      const ok =
        agentKey.length === expected.length &&
        timingSafeEqual(Buffer.from(agentKey), Buffer.from(expected));
      if (!ok) throw new UnauthorizedException("Invalid agent API key");

      const tenantId = req.header("x-agent-tenant-id");
      if (!tenantId || !isTenantId(tenantId)) {
        throw new UnauthorizedException(
          "Agent auth: x-agent-tenant-id header required and must be a uuid",
        );
      }
      const auth: AuthContext = {
        tenantId,
        userId: `agent:${req.header("x-agent-id") ?? "unknown"}`,
        // Least privilege for what the read-only tool surface actually calls
        // — see hermes/TOOLS.md. Never admin, never finance: nothing in the
        // agent's tool list needs either.
        roles: ["ops"],
      };
      (req as Request & Record<string, unknown>)[AUTH_CONTEXT_KEY] = auth;
      return true;
    }

    if (this.cfg.AUTH_MODE === "dev") {
      // Config refuses to boot with AUTH_MODE=dev in production; these
      // headers exist only for local development and tests.
      const tenantId = req.header("x-dev-tenant-id");
      if (!tenantId) {
        throw new UnauthorizedException("Dev auth: x-dev-tenant-id header required");
      }
      if (!isTenantId(tenantId)) {
        throw new UnauthorizedException("Dev auth: x-dev-tenant-id must be a uuid");
      }
      const auth: AuthContext = {
        tenantId,
        userId: req.header("x-dev-user-id") ?? "dev",
        roles: (req.header("x-dev-roles") ?? "admin,finance,ops").split(","),
      };
      (req as Request & Record<string, unknown>)[AUTH_CONTEXT_KEY] = auth;
      return true;
    }

    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    if (!this.verifier) {
      throw new UnauthorizedException("Token verifier not configured");
    }
    try {
      const auth = await this.verifier.verify(header.slice("Bearer ".length));
      (req as Request & Record<string, unknown>)[AUTH_CONTEXT_KEY] = auth;
      return true;
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : "Token verification failed",
      );
    }
  }
}
