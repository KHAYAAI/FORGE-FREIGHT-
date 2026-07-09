import { Module } from "@nestjs/common";
import { IngestController, IngestKeyGuard } from "./ingest.controller.js";
import { IngestService } from "./ingest.service.js";

@Module({
  controllers: [IngestController],
  providers: [IngestService, IngestKeyGuard],
})
export class IngestModule {}
