import {
  ContainerDischarged,
  ContainerGatedIn,
  ContainerGatedOut,
  VesselArrived,
  VesselDeparted,
  type EventDefinition,
} from "@forge-freight/events";
import type { CanonicalEmission, TrackingAdapter } from "./adapter.js";
import { extractIftsta } from "./edifact.js";

/**
 * Per-partner status-code mapping, set at trading-partner onboarding.
 * UN/EDIFACT 4405 code usage varies by carrier — NEVER assume; confirm each
 * partner's code list against their message implementation guide.
 */
export type EdifactStatusMap = Record<
  string,
  "vessel.departed" | "vessel.arrived" | "container.gated_in" | "container.gated_out" | "container.discharged"
>;

export class EdifactIftstaAdapter implements TrackingAdapter {
  readonly source = "EDIFACT";

  constructor(
    private readonly partner: string,
    private readonly statusMap: EdifactStatusMap,
  ) {}

  parse(input: unknown): CanonicalEmission[] {
    if (typeof input !== "string") {
      throw new TypeError("EDIFACT adapter expects the raw interchange as text");
    }
    const statuses = extractIftsta(input);
    const emissions: CanonicalEmission[] = [];

    for (const [i, status] of statuses.entries()) {
      const mapped = this.statusMap[status.statusCode];
      if (!mapped) continue; // unmapped codes are ignored, not guessed
      const occurredAt = status.occurredAt ?? new Date();
      const sourceRef = `edifact:${this.partner}:${status.messageRef}:${i}`;

      if (mapped === "vessel.departed" || mapped === "vessel.arrived") {
        if (!status.consignmentRef) continue;
        emissions.push({
          definition: (mapped === "vessel.departed"
            ? VesselDeparted
            : VesselArrived) as EventDefinition,
          occurredAt,
          sourceRef,
          match: { by: "carrierBookingRef", carrierBookingRef: status.consignmentRef },
          payload:
            mapped === "vessel.departed"
              ? {
                  vesselImo: "0000000", // IFTSTA rarely carries IMO; enriched later
                  vesselName: null,
                  port: status.location ?? "ZZZZZ",
                  source: "EDIFACT",
                  etaDestination: null,
                }
              : {
                  vesselImo: "0000000",
                  port: status.location ?? "ZZZZZ",
                  source: "EDIFACT",
                },
        });
      } else {
        if (!status.containerNumber) continue;
        const definition = (
          {
            "container.gated_in": ContainerGatedIn,
            "container.gated_out": ContainerGatedOut,
            "container.discharged": ContainerDischarged,
          } as Record<string, EventDefinition>
        )[mapped]!;
        emissions.push({
          definition,
          occurredAt,
          sourceRef,
          match: { by: "containerNumber", containerNumber: status.containerNumber },
          payload: {
            containerNumber: status.containerNumber,
            location: status.location ?? "ZZZZZ",
            source: "EDIFACT",
            ...(mapped === "container.gated_out" ? { truckerId: null } : {}),
          },
        });
      }
    }
    return emissions;
  }
}
