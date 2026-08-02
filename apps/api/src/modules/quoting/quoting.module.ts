import { Module } from "@nestjs/common";
import { ConsignmentsModule } from "../consignments/consignments.module.js";
import { RatesModule } from "../rates/rates.module.js";
import { QuotePdfService } from "./quote-pdf.service.js";
import { QuotingController } from "./quoting.controller.js";
import { QuotingService } from "./quoting.service.js";

@Module({
  imports: [RatesModule, ConsignmentsModule],
  controllers: [QuotingController],
  providers: [QuotingService, QuotePdfService],
})
export class QuotingModule {}
