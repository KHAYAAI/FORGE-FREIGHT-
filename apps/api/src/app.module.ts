import { Module } from "@nestjs/common";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { BookingsModule } from "./modules/bookings/bookings.module.js";
import { ComplianceModule } from "./modules/compliance/compliance.module.js";
import { ConfigModule } from "./modules/config/config.module.js";
import { CustomsModule } from "./modules/customs/customs.module.js";
import { DbModule } from "./modules/db/db.module.js";
import { DocumentsModule } from "./modules/documents/documents.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IngestModule } from "./modules/ingest/ingest.module.js";
import { OutboxModule } from "./modules/outbox/outbox.module.js";
import { ProjectorModule } from "./modules/projector/projector.module.js";
import { QuotingModule } from "./modules/quoting/quoting.module.js";
import { RatesModule } from "./modules/rates/rates.module.js";
import { ShipmentsModule } from "./modules/shipments/shipments.module.js";
import { TemporalModule } from "./modules/temporal/temporal.module.js";

/** Modular monolith — keep it a monolith until it hurts. */
@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuthModule,
    TemporalModule,
    OutboxModule,
    ProjectorModule,
    HealthModule,
    RatesModule,
    QuotingModule,
    BookingsModule,
    ShipmentsModule,
    IngestModule,
    ComplianceModule,
    BillingModule,
    CustomsModule,
    DocumentsModule,
  ],
})
export class AppModule {}
