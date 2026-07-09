import { Module } from "@nestjs/common";
import { ClassificationService } from "./classification.service.js";
import { CustomsController } from "./customs.controller.js";
import { CustomsService } from "./customs.service.js";

@Module({
  controllers: [CustomsController],
  providers: [CustomsService, ClassificationService],
})
export class CustomsModule {}
