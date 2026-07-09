import { Module } from "@nestjs/common";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BookingsModule } from "./modules/bookings/bookings.module.js";
import { ConfigModule } from "./modules/config/config.module.js";
import { DbModule } from "./modules/db/db.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { OutboxModule } from "./modules/outbox/outbox.module.js";
import { QuotingModule } from "./modules/quoting/quoting.module.js";
import { RatesModule } from "./modules/rates/rates.module.js";

/**
 * Modular monolith. Modules to come (in build order): shipments (Temporal
 * lifecycle), tracking-ingest adapters, documents, customs, compliance,
 * billing, portal. Keep it a monolith until it hurts.
 */
@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuthModule,
    OutboxModule,
    HealthModule,
    RatesModule,
    QuotingModule,
    BookingsModule,
  ],
})
export class AppModule {}
