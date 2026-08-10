import { Module } from "@nestjs/common";
import { AisListenerService } from "./ais-listener.service.js";
import { IngestController, IngestKeyGuard } from "./ingest.controller.js";
import { IngestService } from "./ingest.service.js";
import { RfqService } from "./rfq.service.js";
import { QuotingModule } from "../quoting/quoting.module.js";

@Module({
  imports: [QuotingModule],
  controllers: [IngestController],
  providers: [IngestService, IngestKeyGuard, AisListenerService, RfqService],
})
export class IngestModule {}
