import { Module } from "@nestjs/common";
import { PartiesController } from "./parties.controller.js";
import { ScreeningService } from "./screening.service.js";

@Module({
  controllers: [PartiesController],
  providers: [ScreeningService],
  exports: [ScreeningService],
})
export class ComplianceModule {}
