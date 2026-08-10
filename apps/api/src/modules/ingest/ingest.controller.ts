import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Inject,
  Injectable,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { CONFIG, type AppConfig } from "../../config.js";
import { DcsaAdapter } from "./dcsa.adapter.js";
import { EdifactIftstaAdapter, type EdifactStatusMap } from "./edifact.adapter.js";
import { IngestService } from "./ingest.service.js";
import { RfqSubmissionDto } from "./rfq.dto.js";
import { RfqService } from "./rfq.service.js";
import { TraccarAdapter } from "./traccar.adapter.js";

/** Machine-to-machine key auth for tracking webhooks (not user JWTs). */
@Injectable()
export class IngestKeyGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.cfg.INGEST_API_KEY) {
      // Dev without a key configured: allow. Production config requires it.
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const presented = req.header("x-api-key") ?? "";
    const expected = this.cfg.INGEST_API_KEY;
    const ok =
      presented.length === expected.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
    if (!ok) throw new UnauthorizedException("Invalid ingest API key");
    return true;
  }
}

/**
 * Per-partner EDIFACT status maps, configured at trading-partner onboarding.
 * The "example" partner documents the shape; real partners are added here
 * (or moved to DB config) after their implementation guide is confirmed.
 */
const EDIFACT_PARTNER_MAPS: Record<string, EdifactStatusMap> = {
  example: {
    DEP: "vessel.departed",
    ARR: "vessel.arrived",
    GIN: "container.gated_in",
    GOUT: "container.gated_out",
    DIS: "container.discharged",
  },
};

/** API-key guarded, but still bounded — a leaked key shouldn't allow unbounded event floods. */
@Controller("ingest")
@UseGuards(IngestKeyGuard)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class IngestController {
  private readonly dcsa = new DcsaAdapter();
  private readonly traccar = new TraccarAdapter();

  constructor(
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(RfqService) private readonly rfq: RfqService,
  ) {}

  @Post("dcsa")
  async ingestDcsa(@Body() body: unknown) {
    return this.ingest.ingest(this.dcsa.parse(body), this.dcsa.source);
  }

  @Post("traccar")
  async ingestTraccar(@Body() body: unknown) {
    return this.ingest.ingest(this.traccar.parse(body), this.traccar.source);
  }

  /**
   * An RFQ from the outside world — an inbox, a form, a partner webhook.
   *
   * Unlike the tracking adapters this one can *refuse* in ways that are not
   * errors: an unknown sender, a party under screening review, a lane with no
   * valid rate. Those come back 200 with a status the caller can branch on,
   * because they are answers rather than failures — n8n retrying them would
   * accomplish nothing.
   */
  @Post("rfq")
  async ingestRfq(@Body() body: unknown) {
    return this.rfq.submit(RfqSubmissionDto.parse(body));
  }

  @Post("edifact")
  async ingestEdifact(@Body() body: unknown, @Query("partner") partner = "example") {
    const map = EDIFACT_PARTNER_MAPS[partner];
    if (!map) {
      throw new UnauthorizedException(`Unknown EDIFACT partner '${partner}'`);
    }
    const raw =
      typeof body === "string"
        ? body
        : typeof (body as { raw?: unknown })?.raw === "string"
          ? (body as { raw: string }).raw
          : "";
    const adapter = new EdifactIftstaAdapter(partner, map);
    return this.ingest.ingest(adapter.parse(raw), adapter.source);
  }
}
