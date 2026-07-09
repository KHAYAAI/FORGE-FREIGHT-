import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";
import { ExtractionService } from "./extraction.service.js";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, ExtractionService],
})
export class DocumentsModule {}
