import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { asc, inArray, isNull } from "drizzle-orm";
import { Kafka, logLevel, type Producer } from "kafkajs";
import { events, type Db } from "@forge-freight/db";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";

export interface OutboxRow {
  eventId: string;
  shipmentId: string | null;
  tenantId: string;
  type: string;
  version: number;
  occurredAt: Date;
  recordedAt: Date;
  actor: unknown;
  sourceRef: string | null;
  payload: unknown;
}

export interface EventPublisher {
  publish(topic: string, rows: OutboxRow[]): Promise<void>;
}

/**
 * Transactional outbox relay: services append events to Postgres in the same
 * transaction as their projection writes; this relay ships unpublished rows
 * to Redpanda in recorded order and stamps published_at. At-least-once —
 * consumers dedupe on eventId.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private producer: Producer | null = null;
  private running = false;
  private ticking = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async onModuleInit() {
    if (!this.cfg.KAFKA_BROKERS) {
      this.logger.warn(
        "KAFKA_BROKERS not set — outbox relay disabled; events stay queued in Postgres",
      );
      return;
    }
    const kafka = new Kafka({
      clientId: "forge-freight-outbox",
      brokers: this.cfg.KAFKA_BROKERS.split(",").map((b) => b.trim()),
      logLevel: logLevel.WARN,
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
    await this.producer.connect();
    this.running = true;
    this.timer = setInterval(() => void this.safeTick(), this.cfg.OUTBOX_POLL_MS);
    this.logger.log(
      `Outbox relay started (topic=${this.cfg.KAFKA_TOPIC_EVENTS}, poll=${this.cfg.OUTBOX_POLL_MS}ms)`,
    );
  }

  async onModuleDestroy() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    await this.producer?.disconnect();
  }

  private async safeTick() {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      await this.tick({
        publish: async (topic, rows) => {
          await this.producer!.send({
            topic,
            messages: rows.map((r) => ({
              // Key by shipment so per-shipment ordering survives partitioning.
              key: r.shipmentId ?? r.eventId,
              value: JSON.stringify({
                ...r,
                occurredAt: r.occurredAt.toISOString(),
                recordedAt: r.recordedAt.toISOString(),
              }),
              headers: { type: r.type, version: String(r.version) },
            })),
          });
        },
      });
    } catch (err) {
      // Broker down is expected operational weather — log and retry next tick.
      this.logger.error(`Outbox tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.ticking = false;
    }
  }

  /** One relay pass. Extracted (with injectable publisher) for tests. */
  async tick(publisher: EventPublisher): Promise<number> {
    const batch: OutboxRow[] = await this.db
      .select({
        eventId: events.eventId,
        shipmentId: events.shipmentId,
        tenantId: events.tenantId,
        type: events.type,
        version: events.version,
        occurredAt: events.occurredAt,
        recordedAt: events.recordedAt,
        actor: events.actor,
        sourceRef: events.sourceRef,
        payload: events.payload,
      })
      .from(events)
      .where(isNull(events.publishedAt))
      .orderBy(asc(events.recordedAt))
      .limit(this.cfg.OUTBOX_BATCH_SIZE);

    if (batch.length === 0) return 0;

    await publisher.publish(this.cfg.KAFKA_TOPIC_EVENTS, batch);
    await this.db
      .update(events)
      .set({ publishedAt: new Date() })
      .where(
        inArray(
          events.eventId,
          batch.map((r) => r.eventId),
        ),
      );
    return batch.length;
  }
}
