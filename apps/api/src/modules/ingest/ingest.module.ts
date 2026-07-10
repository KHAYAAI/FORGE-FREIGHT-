import { Module } from "@nestjs/common";
import { AisListenerService } from "./ais-listener.service.js";
import { IngestController, IngestKeyGuard } from "./ingest.controller.js";
import { IngestService } from "./ingest.service.js";

@Module({
  controllers: [IngestController],
  providers: [IngestService, IngestKeyGuard, AisListenerService],
})
export class IngestModule {}
