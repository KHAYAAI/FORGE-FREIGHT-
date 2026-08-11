import { Module } from "@nestjs/common";
import { IngestKeyGuard } from "../ingest/ingest.controller.js";
import { PolicyModule } from "../policy/policy.module.js";
import { PartiesController } from "./parties.controller.js";
import { RescreeningService } from "./rescreening.service.js";
import { ScheduledComplianceController } from "./scheduled-compliance.controller.js";
import { ScreeningService } from "./screening.service.js";

@Module({
  imports: [PolicyModule],
  controllers: [PartiesController, ScheduledComplianceController],
  providers: [ScreeningService, RescreeningService, IngestKeyGuard],
  exports: [ScreeningService],
})
export class ComplianceModule {}
