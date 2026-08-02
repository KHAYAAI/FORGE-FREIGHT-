import { Module } from "@nestjs/common";
import { ConsignmentsController } from "./consignments.controller.js";
import { ConsignmentsService } from "./consignments.service.js";

@Module({
  controllers: [ConsignmentsController],
  providers: [ConsignmentsService],
  exports: [ConsignmentsService],
})
export class ConsignmentsModule {}
