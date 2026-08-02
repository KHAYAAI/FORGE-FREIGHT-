import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { CONFIG, type AppConfig } from "../../config.js";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { RequireRoles } from "../auth/roles.js";
import { integrationStates } from "./integrations.registry.js";
import { SarsFilingService } from "./sars-filing.service.js";

const FilingDto = z.object({
  kind: z.enum(["SARS_CUSDEC", "SARS_EXPORT_RELEASE", "SARS_VAT201"]),
  payload: z.record(z.unknown()),
  submissionRef: z.string().trim().min(1).max(100),
});

/**
 * What this deployment can and cannot reach, and the statutory filings it has
 * built.
 *
 * The status endpoint exists because "API-ready" is otherwise an unverifiable
 * claim. A forwarder evaluating this platform needs to see, on a screen,
 * which external systems are live, which are dark, and — the part that
 * actually costs time — which ones need an accreditation before any amount of
 * configuration will help.
 */
@Controller()
export class IntegrationsController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(SarsFilingService) private readonly sars: SarsFilingService,
  ) {}

  /**
   * Every external dependency, its state, and what it degrades to.
   *
   * Reports configuration key *names* only, never values — this is rendered on
   * a screen, and an endpoint that says which secrets are set is one small
   * step from one that says what they are.
   */
  @Get("integrations")
  integrations() {
    const states = integrationStates(this.cfg);
    return {
      integrations: states,
      summary: {
        total: states.length,
        configured: states.filter((s) => s.status === "CONFIGURED").length,
        partial: states.filter((s) => s.status === "PARTIAL").length,
        notConfigured: states.filter((s) => s.status === "NOT_CONFIGURED").length,
        blockingProduction: states
          .filter((s) => s.requiredForProduction && s.status !== "CONFIGURED")
          .map((s) => s.name),
        needingAccreditation: states
          .filter((s) => s.accreditation && s.status !== "CONFIGURED")
          .map((s) => ({ name: s.name, accreditation: s.accreditation })),
      },
    };
  }

  @Get("compliance/filings")
  async filings(@CurrentAuth() auth: AuthContext) {
    return {
      filings: await this.sars.list(auth.tenantId),
      channel: {
        enabled: this.sars.enabled,
        missing: this.sars.missingConfiguration(),
      },
    };
  }

  @Get("compliance/filings/:id")
  async filing(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.sars.get(auth.tenantId, id);
  }

  /**
   * Build and lodge a filing.
   *
   * Succeeds whether or not the channel is configured: unconfigured, the
   * declaration is stored complete and stops at QUEUED with the reason on it.
   * A 503 here would lose the work a person just did over a registration they
   * are already waiting on.
   */
  @RequireRoles("ops")
  @Post("shipments/:id/filings")
  async file(
    @Param("id", ParseUUIDPipe) shipmentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = FilingDto.parse(body);
    return this.sars.submit({
      tenantId: auth.tenantId,
      shipmentId,
      kind: dto.kind,
      payload: dto.payload,
      submissionRef: dto.submissionRef,
    });
  }
}
