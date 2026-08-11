import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { events, parties, type Db } from "@forge-freight/db";
import { PartyScreened } from "@forge-freight/events";
import { DB } from "../db/db.module.js";
import {
  MAX_PER_RUN,
  RESCREEN_AFTER_DAYS,
  selectForRescreening,
  type ScreenableParty,
  type ScreeningStatus,
} from "./rescreening-rules.js";
import { ScreeningService } from "./screening.service.js";

export interface RescreenResult {
  /** Parties considered — the whole book. */
  scanned: number;
  /** Stale verdicts found, before the per-run cap. */
  due: number;
  /** Actually asked this run. */
  screened: number;
  /** Verdicts that moved. These are the ones a person needs to see. */
  changed: { name: string; from: string; to: string }[];
  /** Screening is not configured, so nothing could be asked. */
  skipped: number;
}

/**
 * Re-asks the sanctions question about counterparties whose answer has gone
 * stale.
 *
 * Everything needed already exists: `ScreeningService.screenParty` matches
 * against yente, updates `screening_status`, emits `PartyScreened` and raises
 * a `ComplianceHold` on a hit. The only thing missing was anyone ever calling
 * it a second time.
 *
 * Idempotent in the way that matters for a scheduler: asking the same question
 * twice yields the same answer and writes the same status. A double run costs
 * two lookups; a missed run costs a day of staleness.
 */
@Injectable()
export class RescreeningService {
  private readonly logger = new Logger(RescreeningService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ScreeningService) private readonly screening: ScreeningService,
  ) {}

  async sweep(
    now: Date = new Date(),
    limit: number = MAX_PER_RUN,
    intervals: Record<ScreeningStatus, number> = RESCREEN_AFTER_DAYS,
  ): Promise<RescreenResult> {
    const all = await this.loadParties();
    // Uncapped first so the report can say how deep the backlog is, then
    // capped for the work actually done this run. An operator needs to know
    // the queue is 900 long even when only 200 were asked.
    const allDue = selectForRescreening(all, now, Number.MAX_SAFE_INTEGER, intervals);
    const batch = allDue.slice(0, limit);

    const result: RescreenResult = {
      scanned: all.length,
      due: allDue.length,
      screened: 0,
      changed: [],
      skipped: 0,
    };

    for (const p of batch) {
      const outcome = await this.screening.screenParty({
        partyId: p.partyId,
        name: p.name,
        country: p.country,
        tenantId: p.tenantId,
        // No shipment: this is a periodic check on the counterparty itself,
        // not screening triggered by a booking. A hit still updates the party
        // and emits party.screened; the hold is raised when it next touches
        // freight, which is where a hold belongs.
        shipmentId: null,
      });

      if (outcome.verdict === "SKIPPED") {
        result.skipped++;
        continue;
      }
      result.screened++;
      if (outcome.verdict !== p.status) {
        result.changed.push({
          name: p.name,
          from: p.status,
          to: outcome.verdict,
        });
      }
    }

    if (result.changed.length > 0) {
      // Worth its own line at warn level: a verdict moving is the entire
      // reason this job exists, and it should be findable in the logs without
      // reading a run summary.
      this.logger.warn(
        `Re-screening changed ${result.changed.length} verdict(s): ` +
          result.changed
            .map((c) => `${c.name} ${c.from}→${c.to}`)
            .join(", "),
      );
    } else if (result.screened > 0) {
      this.logger.log(
        `Re-screened ${result.screened} part(ies) of ${result.due} due; no change`,
      );
    }
    if (result.skipped > 0) {
      this.logger.warn(
        `Screening is not configured — ${result.skipped} part(ies) could not be checked`,
      );
    }
    return result;
  }

  /**
   * Every party with the date of its last verdict.
   *
   * The date comes from the `party.screened` event rather than a column,
   * because there is no column — and adding one would be a second copy of
   * something the log already records exactly.
   */
  private async loadParties(): Promise<ScreenableParty[]> {
    const rows = await this.db
      .select({
        partyId: parties.id,
        tenantId: parties.tenantId,
        name: parties.name,
        country: parties.country,
        status: parties.screeningStatus,
        lastScreenedAt: sql<Date | null>`(
          select max(e.occurred_at) from ${events} e
          where e.type = ${PartyScreened.type}
            and e.payload->>'partyId' = ${parties.id}::text
        )`,
      })
      .from(parties);

    return rows.map((r) => ({
      partyId: r.partyId,
      tenantId: r.tenantId,
      name: r.name,
      country: r.country,
      status: r.status as ScreeningStatus,
      lastScreenedAt: r.lastScreenedAt ? new Date(r.lastScreenedAt) : null,
    }));
  }
}
