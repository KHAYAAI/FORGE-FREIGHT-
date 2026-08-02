import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, gte } from "drizzle-orm";
import { fuelIndexQuotes, type Db } from "@forge-freight/db";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";
import type { FuelBenchmark } from "../billing/invoice-audit.js";

/**
 * The reference a fuel surcharge is held to.
 *
 * EXTERNAL API. Bunker price assessments (Platts, Argus) and jet fuel indices
 * (IATA) are licensed commercial feeds; carrier BAF tariffs are published but
 * per-carrier. `FUEL_INDEX_URL` points at whichever the operator has licensed.
 *
 * The honest behaviour when it is unset is to return null — *not* a plausible
 * number. Fuel surcharges are the single highest-error category on a forwarder
 * invoice, so a benchmark that is quietly invented would produce confident
 * findings with nothing behind them, which is worse than the check not running:
 * the audit would be citing a figure in a dispute that the vendor can
 * immediately show is fabricated.
 *
 * Quotes are cached in `fuel_index_quotes` so a dispute raised months later can
 * still cite the exact index level the finding was made on.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

@Injectable()
export class FuelIndexService {
  private readonly logger = new Logger(FuelIndexService.name);

  fetchImpl: FetchLike = (url, init) => fetch(url, init);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.cfg.FUEL_INDEX_URL.trim().length > 0;
  }

  /**
   * The benchmark a BAF/EBS line should be measured against, or null with the
   * reason. `null` is a first-class answer here.
   */
  async benchmarkFor(params: {
    indexCode: string;
    currency: string;
    /** Cached quotes older than the configured max age are not trusted. */
    now?: Date;
  }): Promise<{ benchmark: FuelBenchmark | null; reason: string | null }> {
    const now = params.now ?? new Date();
    const cutoff = new Date(now.getTime() - this.cfg.FUEL_INDEX_MAX_AGE_HOURS * 3_600_000);

    const [cached] = await this.db
      .select()
      .from(fuelIndexQuotes)
      .where(
        and(
          eq(fuelIndexQuotes.indexCode, params.indexCode),
          eq(fuelIndexQuotes.currency, params.currency),
          gte(fuelIndexQuotes.quotedFor, cutoff),
        ),
      )
      .orderBy(desc(fuelIndexQuotes.quotedFor))
      .limit(1);

    if (cached) {
      return {
        benchmark: {
          indexCode: cached.indexCode,
          source: cached.source,
          quotedFor: cached.quotedFor.toISOString().slice(0, 10),
          expectedUnitCents: cached.valueCents,
          currency: cached.currency,
        },
        reason: null,
      };
    }

    if (!this.enabled) {
      return {
        benchmark: null,
        reason:
          "No fuel index is configured. Bunker and jet-fuel indices are licensed external feeds — set FUEL_INDEX_URL to validate fuel surcharge lines.",
      };
    }

    const fetched = await this.refresh(params.indexCode, params.currency, now);
    if (!fetched) {
      return {
        benchmark: null,
        reason: `The fuel index feed did not return a usable quote for ${params.indexCode} in ${params.currency}.`,
      };
    }
    return { benchmark: fetched, reason: null };
  }

  /** Pull a quote from the feed and cache it. Returns null on any failure. */
  async refresh(indexCode: string, currency: string, now = new Date()): Promise<FuelBenchmark | null> {
    if (!this.enabled) return null;
    try {
      const url = new URL(`${this.cfg.FUEL_INDEX_URL.replace(/\/$/, "")}/quotes`);
      url.searchParams.set("index", indexCode);
      url.searchParams.set("currency", currency);
      const res = await this.fetchImpl(url.toString(), {
        headers: this.cfg.FUEL_INDEX_API_KEY
          ? { authorization: `Bearer ${this.cfg.FUEL_INDEX_API_KEY}` }
          : {},
      });
      if (!res.ok) {
        this.logger.warn(`Fuel index ${indexCode}: feed returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        valueCents?: number;
        quotedFor?: string;
        source?: string;
      };
      if (typeof body.valueCents !== "number") return null;

      const quotedFor = body.quotedFor ? new Date(body.quotedFor) : now;
      const source = body.source ?? indexCode;

      await this.db
        .insert(fuelIndexQuotes)
        .values({ indexCode, source, quotedFor, valueCents: body.valueCents, currency })
        .onConflictDoNothing({
          target: [fuelIndexQuotes.indexCode, fuelIndexQuotes.quotedFor],
        });

      return {
        indexCode,
        source,
        quotedFor: quotedFor.toISOString().slice(0, 10),
        expectedUnitCents: body.valueCents,
        currency,
      };
    } catch (err) {
      this.logger.warn(
        `Fuel index ${indexCode} unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
