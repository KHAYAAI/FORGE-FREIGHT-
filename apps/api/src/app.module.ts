import { Module } from "@nestjs/common";
import { DbModule } from "./modules/db/db.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { QuotingModule } from "./modules/quoting/quoting.module.js";
import { RatesModule } from "./modules/rates/rates.module.js";

/**
 * Modular monolith. Modules to come (in build order): shipments (Temporal
 * lifecycle), tracking-ingest adapters, documents, customs, compliance,
 * billing, portal. Keep it a monolith until it hurts.
 */
@Module({
  imports: [DbModule, HealthModule, RatesModule, QuotingModule],
})
export class AppModule {}
