import { z } from "zod";
import { VesselPositionReported } from "@forge-freight/events";
import type { CanonicalEmission, TrackingAdapter } from "./adapter.js";

/**
 * aisstream.io position/static-data adapter.
 *
 * AIS itself is MMSI-keyed, not IMO-keyed: a PositionReport carries the
 * broadcasting station's MMSI (UserID), and the IMO number — which is what
 * `legs.vessel_imo` stores, matching DCSA's own vocabulary — only appears in
 * the much rarer ShipStaticData message. So this adapter is stateful: it
 * learns the MMSI→IMO mapping from ShipStaticData as it arrives and can only
 * emit a position for a vessel once that mapping is known. A cold-started
 * listener will silently drop position reports for vessels it hasn't seen
 * static data for yet — this is normal AIS behavior, not a bug, and static
 * data is typically broadcast every few minutes per vessel.
 */
const AisStaticData = z.object({
  MessageType: z.literal("ShipStaticData"),
  MetaData: z.object({ MMSI: z.number(), time_utc: z.string().optional() }),
  Message: z.object({
    ShipStaticData: z.object({
      ImoNumber: z.number(),
    }),
  }),
});

const AisPositionReport = z.object({
  MessageType: z.literal("PositionReport"),
  MetaData: z.object({ MMSI: z.number(), time_utc: z.string().optional() }),
  Message: z.object({
    PositionReport: z.object({
      Latitude: z.number(),
      Longitude: z.number(),
      Sog: z.number().nullable().optional(), // speed over ground, knots
      Cog: z.number().nullable().optional(), // course over ground, degrees
      TrueHeading: z.number().nullable().optional(),
    }),
  }),
});

function toImo(n: number): string {
  return String(n).padStart(7, "0");
}

export class AisAdapter implements TrackingAdapter {
  readonly source = "AIS";

  private readonly mmsiToImo = new Map<number, string>();

  /** Vessels we currently care about — position pings for anything else are dropped. */
  private trackedImos = new Set<string>();

  setTrackedVessels(imoNumbers: string[]): void {
    this.trackedImos = new Set(imoNumbers);
  }

  parse(input: unknown): CanonicalEmission[] {
    const staticData = AisStaticData.safeParse(input);
    if (staticData.success) {
      this.mmsiToImo.set(staticData.data.MetaData.MMSI, toImo(staticData.data.Message.ShipStaticData.ImoNumber));
      return [];
    }

    const position = AisPositionReport.safeParse(input);
    if (!position.success) return [];

    const mmsi = position.data.MetaData.MMSI;
    const imo = this.mmsiToImo.get(mmsi);
    if (!imo || !this.trackedImos.has(imo)) return [];

    const report = position.data.Message.PositionReport;
    const occurredAt = position.data.MetaData.time_utc
      ? new Date(`${position.data.MetaData.time_utc.replace(" ", "T")}Z`)
      : new Date();

    return [
      {
        definition: VesselPositionReported,
        occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
        // AIS resends position reports every few seconds; round to the
        // minute so idempotency dedupes the flood without losing real track.
        sourceRef: `ais:${mmsi}:${occurredAt.toISOString().slice(0, 16)}`,
        match: { by: "vesselImo", vesselImo: imo },
        payload: {
          // legId is resolved by the ingest service from the vesselImo match.
          legId: "00000000-0000-0000-0000-000000000000",
          vesselImo: imo,
          lat: report.Latitude,
          lon: report.Longitude,
          speedKnots: report.Sog ?? null,
          heading: report.TrueHeading != null && report.TrueHeading <= 359 ? report.TrueHeading : null,
        },
      },
    ];
  }
}
