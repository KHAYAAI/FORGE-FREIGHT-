import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { consumerOffsets, events, type Db } from "@forge-freight/db";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";

export interface StoredEvent {
  eventId: string;
  shipmentId: string | null;
  tenantId: string;
  type: string;
  version: number;
  occurredAt: Date;
  recordedAt: Date;
  payload: Record<string, unknown>;
}

export interface EventHandler {
  /** Watermarked consumer name — must be stable across deploys. */
  name: string;
  handle(event: StoredEvent, db: Db): Promise<void>;
}

export const EVENT_HANDLERS = Symbol("EVENT_HANDLERS");

const EPOCH = new Date(0);
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * In-process event consumer: replays the append-only events table through
 * registered handlers (lifecycle projector, billing accrual, ledger sink),
 * each with its own durable watermark. Handlers must be idempotent — a crash
 * between handling and watermark advance replays the batch.
 *
 * This runs alongside the Redpanda outbox relay: external consumers read the
 * topic, internal projections read the table directly (no broker required).
 */
@Injectable()
export class EventDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(EVENT_HANDLERS) private readonly handlers: EventHandler[],
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.safeTick(), this.cfg.OUTBOX_POLL_MS);
    this.logger.log(
      `Event dispatcher started (${this.handlers.map((h) => h.name).join(", ")})`,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const handler of this.handlers) {
        await this.drain(handler);
      }
    } catch (err) {
      this.logger.error(
        `Dispatcher tick failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  /** Process everything past the handler's watermark. Exposed for tests/manual replay. */
  async drain(handler: EventHandler): Promise<number> {
    let processed = 0;
    for (;;) {
      const [offset] = await this.db
        .select()
        .from(consumerOffsets)
        .where(eq(consumerOffsets.consumer, handler.name));
      const afterAt = offset?.lastRecordedAt ?? EPOCH;
      const afterId = offset?.lastEventId ?? ZERO_UUID;

      const batch = await this.db
        .select()
        .from(events)
        .where(
          sql`(${events.recordedAt}, ${events.eventId}) > (${afterAt.toISOString()}::timestamptz, ${afterId}::uuid)`,
        )
        .orderBy(asc(events.recordedAt), asc(events.eventId))
        .limit(this.cfg.OUTBOX_BATCH_SIZE);
      if (batch.length === 0) return processed;

      for (const row of batch) {
        await handler.handle(
          {
            eventId: row.eventId,
            shipmentId: row.shipmentId,
            tenantId: row.tenantId,
            type: row.type,
            version: row.version,
            occurredAt: row.occurredAt,
            recordedAt: row.recordedAt,
            payload: row.payload as Record<string, unknown>,
          },
          this.db,
        );
        await this.db
          .insert(consumerOffsets)
          .values({
            consumer: handler.name,
            lastRecordedAt: row.recordedAt,
            lastEventId: row.eventId,
          })
          .onConflictDoUpdate({
            target: consumerOffsets.consumer,
            set: { lastRecordedAt: row.recordedAt, lastEventId: row.eventId },
          });
        processed++;
      }
    }
  }
}
