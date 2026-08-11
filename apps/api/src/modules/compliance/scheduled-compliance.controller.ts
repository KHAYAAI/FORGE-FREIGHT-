import { Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { IngestKeyGuard } from "../ingest/ingest.controller.js";
import { AutonomyPolicyService } from "../policy/autonomy-policy.service.js";
import { RescreeningService, type RescreenResult } from "./rescreening.service.js";

/**
 * Compliance work a scheduler calls. Machine-authenticated, not a human
 * surface — see `shipments/scheduled.controller.ts` for the same pattern.
 *
 * Kept beside the compliance code rather than gathered into one scheduled
 * module, so the rules and the endpoint that runs them stay in the same
 * folder. The full list of scheduled endpoints lives in
 * `infrastructure/kestra/WORKFLOWS.md`.
 */
@Controller("scheduled")
@UseGuards(IngestKeyGuard)
export class ScheduledComplianceController {
  constructor(
    @Inject(RescreeningService) private readonly rescreening: RescreeningService,
    @Inject(AutonomyPolicyService) private readonly policy: AutonomyPolicyService,
  ) {}

  /**
   * Re-ask the sanctions question about counterparties whose answer has gone
   * stale. Intervals and the per-run cap come from
   * `config/autonomy-policy.yaml` — this is the one endpoint in the codebase
   * with real regulatory exposure if the numbers are wrong, so they are not
   * buried in a constant.
   *
   * Safe at any cadence. Asking twice returns the same answer and writes the
   * same status; the per-run cap means a large book drains over several runs
   * rather than arriving at the provider all at once.
   */
  @Post("rescreen-parties")
  @HttpCode(200)
  async rescreen(): Promise<RescreenResult> {
    return this.rescreening.sweep(
      new Date(),
      this.policy.rescreenMaxPerRun,
      this.policy.rescreenAfterDays,
    );
  }
}
