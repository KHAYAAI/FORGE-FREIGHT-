import { Module } from "@nestjs/common";
import { RatesModule } from "../rates/rates.module.js";
import { QuotingController } from "./quoting.controller.js";
import { QuotingService } from "./quoting.service.js";

@Module({
  imports: [RatesModule],
  controllers: [QuotingController],
  providers: [QuotingService],
})
export class QuotingModule {}
