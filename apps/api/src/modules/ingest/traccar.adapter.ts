import { z } from "zod";
import { RoadPositionReported } from "@forge-freight/events";
import type { CanonicalEmission, TrackingAdapter } from "./adapter.js";

/**
 * Traccar position-forwarding webhook (Durban–Joburg corridor visibility).
 * The device's uniqueId is matched to legs.traccar_device_id; the leg id is
 * filled in by the ingest service after resolution.
 */
const TraccarWebhook = z.object({
  position: z.object({
    id: z.number(),
    latitude: z.number(),
    longitude: z.number(),
    speed: z.number().optional(), // knots in Traccar
    fixTime: z.string().optional(),
  }),
  device: z.object({
    uniqueId: z.string(),
  }),
});

const KNOTS_TO_KPH = 1.852;

export class TraccarAdapter implements TrackingAdapter {
  readonly source = "TRACCAR";

  parse(input: unknown): CanonicalEmission[] {
    const hook = TraccarWebhook.parse(input);
    return [
      {
        definition: RoadPositionReported,
        occurredAt: hook.position.fixTime ? new Date(hook.position.fixTime) : new Date(),
        sourceRef: `traccar:${hook.position.id}`,
        match: { by: "traccarDevice", deviceId: hook.device.uniqueId },
        payload: {
          // legId is resolved by the ingest service from the device match.
          legId: "00000000-0000-0000-0000-000000000000",
          lat: hook.position.latitude,
          lon: hook.position.longitude,
          speedKph:
            hook.position.speed != null
              ? Math.round(hook.position.speed * KNOTS_TO_KPH * 10) / 10
              : null,
          deviceId: hook.device.uniqueId,
        },
      },
    ];
  }
}
