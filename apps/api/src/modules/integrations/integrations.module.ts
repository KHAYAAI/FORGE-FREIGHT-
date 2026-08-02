import { Global, Module } from "@nestjs/common";
import { FuelIndexService } from "./fuel-index.service.js";
import { IntegrationsController } from "./integrations.controller.js";
import { SarsFilingService } from "./sars-filing.service.js";
import { TerminalEventsService } from "./terminal-events.service.js";

/**
 * The seams to everything outside this system.
 *
 * Global because billing reaches for the fuel index and the terminal clock,
 * and customs reaches for the filing channel — wiring the same three providers
 * into every module that needs one would guarantee they drift.
 */
@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [SarsFilingService, FuelIndexService, TerminalEventsService],
  exports: [SarsFilingService, FuelIndexService, TerminalEventsService],
})
export class IntegrationsModule {}
