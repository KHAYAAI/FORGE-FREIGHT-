import { Module } from "@nestjs/common";
import { RatesService } from "./rates.service.js";

@Module({
  providers: [RatesService],
  exports: [RatesService],
})
export class RatesModule {}
