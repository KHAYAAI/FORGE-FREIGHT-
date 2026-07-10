import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import WebSocket from "ws";
import { legs, shipments, type Db } from "@forge-freight/db";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";
import { AisAdapter } from "./ais.adapter.js";
import { IngestService } from "./ingest.service.js";

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const ACTIVE_STATUSES = ["BOOKED", "IN_TRANSIT", "AT_DESTINATION_PORT", "CUSTOMS", "ON_DELIVERY"];
const RECONNECT_DELAY_MS = 5_000;

/**
 * Live vessel position visibility via aisstream.io. Disabled (no-op) unless
 * AISSTREAM_API_KEY is set — same "empty config = skip, don't fail" pattern
 * as the outbox relay and yente screening. When enabled: maintains a
 * WebSocket subscription, refreshes the set of vessel IMOs worth tracking
 * from active ocean legs, and feeds parsed positions through the same
 * IngestService every other tracking adapter uses.
 *
 * Subscribes globally (aisstream has no IMO-based filter — only bounding
 * box and MMSI, and MMSI isn't known until a ShipStaticData message teaches
 * the adapter the mapping) and lets AisAdapter's tracked-vessel set do the
 * actual filtering before anything reaches the database.
 */
@Injectable()
export class AisListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AisListenerService.name);
  private readonly adapter = new AisAdapter();
  private ws: WebSocket | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  async onModuleInit() {
    if (!this.cfg.AISSTREAM_API_KEY) {
      this.logger.warn("AISSTREAM_API_KEY not set — AIS vessel position listener disabled");
      return;
    }
    await this.refreshTrackedVessels();
    this.refreshTimer = setInterval(
      () => void this.refreshTrackedVessels(),
      this.cfg.AIS_VESSEL_REFRESH_MS,
    );
    this.connect();
  }

  onModuleDestroy() {
    this.closing = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  /** Vessel IMOs worth spending the subscription's attention on right now. */
  private async refreshTrackedVessels() {
    try {
      const rows = await this.db
        .selectDistinct({ vesselImo: legs.vesselImo })
        .from(legs)
        .innerJoin(shipments, eq(legs.shipmentId, shipments.id))
        .where(
          and(
            eq(legs.mode, "OCEAN"),
            isNotNull(legs.vesselImo),
            inArray(shipments.status, ACTIVE_STATUSES as never),
          ),
        );
      const imos = rows.map((r) => r.vesselImo).filter((v): v is string => v !== null);
      this.adapter.setTrackedVessels(imos);
      this.logger.log(`Tracking ${imos.length} vessel(s) by IMO`);
    } catch (err) {
      this.logger.error(
        `Failed to refresh tracked vessels: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private connect() {
    if (this.closing) return;
    this.ws = new WebSocket(AISSTREAM_URL);

    this.ws.on("open", () => {
      this.logger.log("Connected to aisstream.io");
      this.ws!.send(
        JSON.stringify({
          APIKey: this.cfg.AISSTREAM_API_KEY,
          // Global box — aisstream can't filter by IMO server-side; the
          // adapter's tracked-vessel set does the real filtering.
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        }),
      );
    });

    this.ws.on("message", (raw) => void this.handleMessage(raw.toString()));

    this.ws.on("error", (err) => {
      this.logger.error(`aisstream connection error: ${err.message}`);
    });

    this.ws.on("close", () => {
      if (this.closing) return;
      this.logger.warn(`aisstream connection closed — reconnecting in ${RECONNECT_DELAY_MS}ms`);
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    });
  }

  private async handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const emissions = this.adapter.parse(parsed);
    if (emissions.length === 0) return;
    await this.ingest.ingest(emissions, this.adapter.source);
  }
}
