import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { containers, events, type Db } from "@forge-freight/db";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";

/**
 * The gate clock that demurrage and detention are computed from.
 *
 * Demurrage runs from discharge until the container leaves the terminal;
 * detention runs from there until the empty is returned. Both are re-derivable
 * to the day from three timestamps and the free-time allowance on the bill of
 * lading — which is exactly why an unverifiable demurrage line is worth
 * querying, and why a verifiable one closes the argument in a sentence.
 *
 * Two sources, in order of preference:
 *
 *   1. This platform's own event log, when carrier track-and-trace has already
 *      delivered `container.discharged` / `container.gated_out`. Free, already
 *      there, and the same record the customer sees on their timeline.
 *   2. EXTERNAL API — the terminal operating system (Navis N4 and equivalents)
 *      or the carrier's equipment-history endpoint, via `TERMINAL_EVENTS_URL`.
 *      Terminals expose this only to registered hauliers and agents, so it is
 *      a per-terminal data agreement rather than a sign-up.
 *
 * With neither, this returns nulls and the audit reports the demurrage line as
 * unverifiable. It does not estimate. A guessed gate-out date produces a
 * confident finding that collapses the moment the terminal is asked.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GateClock {
  dischargedAt: Date | null;
  gateOutAt: Date | null;
  emptyReturnedAt: Date | null;
  /** Where each timestamp came from, so a dispute can say. */
  source: "EVENT_LOG" | "TERMINAL_API" | "NONE";
  /** Populated when the clock is incomplete. */
  reason: string | null;
}

const DISCHARGE_EVENTS = ["container.discharged"];
const GATE_OUT_EVENTS = ["container.gated_out"];

@Injectable()
export class TerminalEventsService {
  private readonly logger = new Logger(TerminalEventsService.name);

  fetchImpl: FetchLike = (url, init) => fetch(url, init);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.cfg.TERMINAL_EVENTS_URL.trim().length > 0;
  }

  async gateClock(shipmentId: string, tenantId: string): Promise<GateClock> {
    const rows = await this.db
      .select({ type: events.type, occurredAt: events.occurredAt })
      .from(events)
      .where(
        and(
          eq(events.shipmentId, shipmentId),
          eq(events.tenantId, tenantId),
          inArray(events.type, [...DISCHARGE_EVENTS, ...GATE_OUT_EVENTS]),
        ),
      );

    const earliest = (types: string[]) => {
      const hits = rows.filter((r) => types.includes(r.type)).map((r) => r.occurredAt);
      return hits.length === 0 ? null : new Date(Math.min(...hits.map((d) => d.getTime())));
    };

    const dischargedAt = earliest(DISCHARGE_EVENTS);
    const gateOutAt = earliest(GATE_OUT_EVENTS);

    if (dischargedAt && gateOutAt) {
      // The empty return is rarely in the carrier's milestone feed; without the
      // terminal API it stays null, which only limits the overlap check.
      const empty = this.enabled ? await this.emptyReturn(shipmentId, tenantId) : null;
      return { dischargedAt, gateOutAt, emptyReturnedAt: empty, source: "EVENT_LOG", reason: null };
    }

    if (!this.enabled) {
      return {
        dischargedAt,
        gateOutAt,
        emptyReturnedAt: null,
        source: dischargedAt || gateOutAt ? "EVENT_LOG" : "NONE",
        reason:
          "Terminal gate timestamps are incomplete and no terminal feed is configured. Demurrage and detention cannot be recomputed — set TERMINAL_EVENTS_URL, or record the gate events from the ops screen.",
      };
    }

    const remote = await this.fetchFromTerminal(shipmentId, tenantId);
    if (!remote) {
      return {
        dischargedAt,
        gateOutAt,
        emptyReturnedAt: null,
        source: dischargedAt || gateOutAt ? "EVENT_LOG" : "NONE",
        reason: "The terminal feed did not return equipment history for this shipment.",
      };
    }
    return { ...remote, source: "TERMINAL_API", reason: null };
  }

  private async emptyReturn(shipmentId: string, tenantId: string): Promise<Date | null> {
    const remote = await this.fetchFromTerminal(shipmentId, tenantId);
    return remote?.emptyReturnedAt ?? null;
  }

  private async fetchFromTerminal(
    shipmentId: string,
    tenantId: string,
  ): Promise<Omit<GateClock, "source" | "reason"> | null> {
    const containerRows = await this.db
      .select({ number: containers.containerNumber })
      .from(containers)
      .where(eq(containers.shipmentId, shipmentId));
    const equipment = containerRows
      .map((c) => c.number)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    if (equipment.length === 0) return null;

    try {
      const url = new URL(`${this.cfg.TERMINAL_EVENTS_URL.replace(/\/$/, "")}/equipment-history`);
      url.searchParams.set("equipment", equipment.join(","));
      const res = await this.fetchImpl(url.toString(), {
        headers: this.cfg.TERMINAL_EVENTS_API_KEY
          ? { authorization: `Bearer ${this.cfg.TERMINAL_EVENTS_API_KEY}` }
          : {},
      });
      if (!res.ok) {
        this.logger.warn(`Terminal feed returned ${res.status} for shipment ${shipmentId}`);
        return null;
      }
      const body = (await res.json()) as {
        dischargedAt?: string;
        gateOutAt?: string;
        emptyReturnedAt?: string;
      };
      const parse = (s?: string) => (s ? new Date(s) : null);
      return {
        dischargedAt: parse(body.dischargedAt),
        gateOutAt: parse(body.gateOutAt),
        emptyReturnedAt: parse(body.emptyReturnedAt),
      };
    } catch (err) {
      this.logger.warn(
        `Terminal feed unavailable for ${tenantId}/${shipmentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
