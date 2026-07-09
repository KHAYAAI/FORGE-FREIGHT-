import { z } from "zod";
import {
  ContainerDischarged,
  ContainerGatedIn,
  ContainerGatedOut,
  ContainerLoaded,
  VesselArrived,
  VesselDeparted,
} from "@forge-freight/events";
import type { CanonicalEmission, TrackingAdapter } from "./adapter.js";

/**
 * DCSA Track & Trace adapter (v3-shaped events, simplified to the fields we
 * consume). Accepts a single event or an array. Only ACT (actual) events
 * become canonical history; EST/PLN are ignored — projections never contain
 * estimates.
 */
const DcsaTransportEvent = z.object({
  eventID: z.string(),
  eventType: z.literal("TRANSPORT"),
  eventClassifierCode: z.enum(["ACT", "EST", "PLN"]),
  transportEventTypeCode: z.enum(["DEPA", "ARRI"]),
  eventDateTime: z.string(),
  transportCall: z.object({
    UNLocationCode: z.string(),
    vessel: z
      .object({
        vesselIMONumber: z.string(),
        name: z.string().optional(),
      })
      .optional(),
  }),
  documentReferences: z
    .array(z.object({ type: z.string(), value: z.string() }))
    .optional(),
});

const DcsaEquipmentEvent = z.object({
  eventID: z.string(),
  eventType: z.literal("EQUIPMENT"),
  eventClassifierCode: z.enum(["ACT", "EST", "PLN"]),
  equipmentEventTypeCode: z.enum(["GTIN", "GTOT", "LOAD", "DISC"]),
  equipmentReference: z.string(),
  eventDateTime: z.string(),
  eventLocation: z.object({ UNLocationCode: z.string() }),
});

const DcsaEvent = z.discriminatedUnion("eventType", [
  DcsaTransportEvent,
  DcsaEquipmentEvent,
]);

export class DcsaAdapter implements TrackingAdapter {
  readonly source = "DCSA";

  parse(input: unknown): CanonicalEmission[] {
    const raw = Array.isArray(input) ? input : [input];
    const emissions: CanonicalEmission[] = [];

    for (const item of raw) {
      const event = DcsaEvent.parse(item);
      if (event.eventClassifierCode !== "ACT") continue;
      const occurredAt = new Date(event.eventDateTime);

      if (event.eventType === "TRANSPORT") {
        const imo = event.transportCall.vessel?.vesselIMONumber;
        if (!imo) continue;
        const bookingRef = event.documentReferences?.find((d) => d.type === "BKG")?.value;
        const match = bookingRef
          ? ({ by: "carrierBookingRef", carrierBookingRef: bookingRef } as const)
          : ({ by: "vesselImo", vesselImo: imo } as const);
        if (event.transportEventTypeCode === "DEPA") {
          emissions.push({
            definition: VesselDeparted,
            occurredAt,
            sourceRef: `dcsa:${event.eventID}`,
            match,
            payload: {
              vesselImo: imo,
              vesselName: event.transportCall.vessel?.name ?? null,
              port: event.transportCall.UNLocationCode,
              source: "DCSA",
              etaDestination: null,
            },
          });
        } else {
          emissions.push({
            definition: VesselArrived,
            occurredAt,
            sourceRef: `dcsa:${event.eventID}`,
            match,
            payload: {
              vesselImo: imo,
              port: event.transportCall.UNLocationCode,
              source: "DCSA",
            },
          });
        }
      } else {
        const base = {
          occurredAt,
          sourceRef: `dcsa:${event.eventID}`,
          match: {
            by: "containerNumber",
            containerNumber: event.equipmentReference,
          } as const,
        };
        const location = event.eventLocation.UNLocationCode;
        const container = event.equipmentReference;
        switch (event.equipmentEventTypeCode) {
          case "GTIN":
            emissions.push({
              ...base,
              definition: ContainerGatedIn,
              payload: { containerNumber: container, location, source: "DCSA" },
            });
            break;
          case "LOAD":
            emissions.push({
              ...base,
              definition: ContainerLoaded,
              payload: {
                containerNumber: container,
                vesselImo: null,
                location,
                source: "DCSA",
              },
            });
            break;
          case "DISC":
            emissions.push({
              ...base,
              definition: ContainerDischarged,
              payload: { containerNumber: container, location, source: "DCSA" },
            });
            break;
          case "GTOT":
            emissions.push({
              ...base,
              definition: ContainerGatedOut,
              payload: {
                containerNumber: container,
                location,
                truckerId: null,
                source: "DCSA",
              },
            });
            break;
        }
      }
    }
    return emissions;
  }
}
