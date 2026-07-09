import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { parties, type Db } from "@forge-freight/db";
import {
  ComplianceHold,
  makeEvent,
  PartyScreened,
} from "@forge-freight/events";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";
import { appendEvent } from "../db/event-store.js";

export type ScreeningVerdict = "CLEAR" | "REVIEW" | "HIT" | "SKIPPED";

export interface ScreeningOutcome {
  verdict: ScreeningVerdict;
  matchScore: number | null;
  listRefs: string[];
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const HIT_THRESHOLD = 0.85;
const REVIEW_THRESHOLD = 0.6;

/**
 * Denied-party screening against yente (OpenSanctions). Every party is
 * screened at creation and re-screened at booking. HIT blocks and raises a
 * compliance hold; REVIEW queues for a human; unset YENTE_URL skips in dev
 * (production config requires it).
 */
@Injectable()
export class ScreeningService {
  private readonly logger = new Logger(ScreeningService.name);

  /** Overridable for tests — Nest injects nothing here. */
  fetchImpl: FetchLike = (url, init) => fetch(url, init);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async screenParty(params: {
    partyId: string;
    name: string;
    country: string | null;
    tenantId: string;
    shipmentId?: string | null;
  }): Promise<ScreeningOutcome> {
    const outcome = await this.match(params.name, params.country);

    if (outcome.verdict !== "SKIPPED") {
      await this.db
        .update(parties)
        .set({ screeningStatus: outcome.verdict })
        .where(eq(parties.id, params.partyId));

      await appendEvent(
        this.db,
        makeEvent({
          definition: PartyScreened,
          tenantId: params.tenantId,
          actor: { kind: "SYSTEM", id: "screening" },
          shipmentId: params.shipmentId ?? null,
          payload: {
            partyId: params.partyId,
            result: outcome.verdict,
            matchScore: outcome.matchScore,
            listRefs: outcome.listRefs,
          },
        }),
      );

      if (outcome.verdict === "HIT" && params.shipmentId) {
        await appendEvent(
          this.db,
          makeEvent({
            definition: ComplianceHold,
            tenantId: params.tenantId,
            actor: { kind: "SYSTEM", id: "screening" },
            shipmentId: params.shipmentId,
            payload: {
              partyId: params.partyId,
              reason: `Sanctions screening hit (${outcome.listRefs.join(", ") || "unspecified list"})`,
            },
          }),
        );
      }
    }
    return outcome;
  }

  /** Raw yente /match call. */
  private async match(
    name: string,
    country: string | null,
  ): Promise<ScreeningOutcome> {
    if (!this.cfg.YENTE_URL) {
      this.logger.warn(`YENTE_URL unset — screening skipped for "${name}" (dev only)`);
      return { verdict: "SKIPPED", matchScore: null, listRefs: [] };
    }

    const res = await this.fetchImpl(
      `${this.cfg.YENTE_URL.replace(/\/$/, "")}/match/default`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queries: {
            q: {
              schema: "LegalEntity",
              properties: {
                name: [name],
                ...(country ? { country: [country] } : {}),
              },
            },
          },
        }),
      },
    );
    if (!res.ok) {
      // Fail closed: screening infrastructure down means human review, not a pass.
      this.logger.error(`yente returned ${res.status} — marking for review`);
      return { verdict: "REVIEW", matchScore: null, listRefs: [] };
    }

    const body = (await res.json()) as {
      responses?: {
        q?: {
          results?: Array<{
            score: number;
            datasets?: string[];
            match?: boolean;
          }>;
        };
      };
    };
    const results = body.responses?.q?.results ?? [];
    const top = results[0];
    if (!top) return { verdict: "CLEAR", matchScore: null, listRefs: [] };

    const listRefs = top.datasets ?? [];
    if (top.match || top.score >= HIT_THRESHOLD) {
      return { verdict: "HIT", matchScore: top.score, listRefs };
    }
    if (top.score >= REVIEW_THRESHOLD) {
      return { verdict: "REVIEW", matchScore: top.score, listRefs };
    }
    return { verdict: "CLEAR", matchScore: top.score, listRefs: [] };
  }
}
