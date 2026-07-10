import { Controller, Get, Inject } from "@nestjs/common";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import {
  consumerOffsets,
  customsEntries,
  documents,
  events,
  invoices,
  parties,
  shipmentExceptions,
  shipments,
  type Db,
} from "@forge-freight/db";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";

/** Watermarked consumers the dispatcher drains, in registration order. */
const KNOWN_CONSUMERS = [
  "lifecycle-projector",
  "billing-accrual",
  "ledger-sink",
  "workflow-signaler",
] as const;

/**
 * Operations telemetry for the system-monitor screen: event throughput,
 * outbox/consumer lag, exception backlog, and per-tenant entity counts.
 * Read-only, cheap aggregate queries — no new tables, derived entirely from
 * the events/consumer_offsets/exceptions rows the platform already writes.
 */
@Controller("system")
export class SystemController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get("monitor")
  async monitor(@CurrentAuth() auth: AuthContext) {
    const [
      dbOk,
      eventTotals,
      eventsLastHour,
      outboxBacklog,
      offsets,
      latestEvent,
      exceptionsByCode,
      shipmentsByStatus,
      documentsInReview,
      customsByStatus,
      invoicesOutstanding,
      partyCount,
    ] = await Promise.all([
      this.dbPing(),
      this.db.select({ n: count() }).from(events).where(eq(events.tenantId, auth.tenantId)),
      this.db
        .select({ n: count() })
        .from(events)
        .where(
          and(
            eq(events.tenantId, auth.tenantId),
            gt(events.recordedAt, sql`now() - interval '1 hour'`),
          ),
        ),
      this.db.select({ n: count() }).from(events).where(isNull(events.publishedAt)),
      this.db.select().from(consumerOffsets),
      this.db
        .select({ recordedAt: events.recordedAt })
        .from(events)
        .where(eq(events.tenantId, auth.tenantId))
        .orderBy(sql`${events.recordedAt} desc`)
        .limit(1),
      this.db
        .select({ code: shipmentExceptions.code, n: count() })
        .from(shipmentExceptions)
        .where(
          and(eq(shipmentExceptions.tenantId, auth.tenantId), isNull(shipmentExceptions.clearedAt)),
        )
        .groupBy(shipmentExceptions.code),
      this.db
        .select({ status: shipments.status, n: count() })
        .from(shipments)
        .where(eq(shipments.tenantId, auth.tenantId))
        .groupBy(shipments.status),
      this.db
        .select({ n: count() })
        .from(documents)
        .where(
          and(eq(documents.tenantId, auth.tenantId), eq(documents.reviewStatus, "PENDING_REVIEW")),
        ),
      this.db
        .select({ status: customsEntries.status, n: count() })
        .from(customsEntries)
        .where(eq(customsEntries.tenantId, auth.tenantId))
        .groupBy(customsEntries.status),
      this.db
        .select({ n: count() })
        .from(invoices)
        .where(and(eq(invoices.tenantId, auth.tenantId), eq(invoices.status, "ISSUED"))),
      this.db.select({ n: count() }).from(parties).where(eq(parties.tenantId, auth.tenantId)),
    ]);

    const now = Date.now();
    const consumers = KNOWN_CONSUMERS.map((name) => {
      const row = offsets.find((o) => o.consumer === name);
      const lagMs = row ? now - new Date(row.lastRecordedAt).getTime() : null;
      return {
        name,
        lastEventId: row?.lastEventId ?? null,
        lastRecordedAt: row?.lastRecordedAt ?? null,
        lagMs,
        healthy: lagMs === null || lagMs < 60_000,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      infra: {
        database: dbOk,
        kafkaConfigured: Boolean(this.cfg.KAFKA_BROKERS),
        temporalConfigured: Boolean(this.cfg.TEMPORAL_ADDRESS),
        outboxPollMs: this.cfg.OUTBOX_POLL_MS,
      },
      events: {
        total: eventTotals[0]?.n ?? 0,
        lastHour: eventsLastHour[0]?.n ?? 0,
        outboxUnpublished: outboxBacklog[0]?.n ?? 0,
        latestRecordedAt: latestEvent[0]?.recordedAt ?? null,
      },
      consumers,
      exceptions: {
        total: exceptionsByCode.reduce((sum, r) => sum + r.n, 0),
        byCode: exceptionsByCode,
      },
      entities: {
        shipmentsByStatus,
        documentsInReview: documentsInReview[0]?.n ?? 0,
        customsByStatus,
        invoicesOutstanding: invoicesOutstanding[0]?.n ?? 0,
        parties: partyCount[0]?.n ?? 0,
      },
    };
  }

  private async dbPing(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }
}
