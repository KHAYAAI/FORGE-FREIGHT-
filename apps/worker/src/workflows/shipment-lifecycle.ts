/**
 * Shipment lifecycle workflow. One instance per shipment, alive for the
 * whole journey (weeks). Milestone events arrive as signals from the API's
 * event stream; the workflow's job is TIME — noticing what has NOT happened
 * and raising exceptions the ops kanban surfaces:
 *
 * - booked but no departure within `departureSlaDays`  → CONGESTION_DELAY
 * - departed but no arrival within transit + grace     → CONGESTION_DELAY
 * - arrived but no customs release within release SLA  → CUSTOMS_QUERY nudge
 * - rolled booking / customs stop signals              → immediate exception
 *
 * State transitions reuse the same semantics as the API's lifecycle reducer.
 * Only workflow-safe imports here (no Node APIs) — this file is bundled into
 * the deterministic workflow sandbox.
 */
import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type * as activities from "../activities.js";

export interface ShipmentWorkflowInput {
  shipmentId: string;
  tenantId: string;
  transitDays: number | null;
  departureSlaDays?: number;
  arrivalGraceDays?: number;
  customsReleaseSlaDays?: number;
}

export interface MilestoneSignal {
  type: string;
  occurredAt: string;
}

export const milestoneSignal = defineSignal<[MilestoneSignal]>("milestone");
export const cancelSignal = defineSignal("cancel");
export const statusQuery = defineQuery<string>("status");

const DAY_MS = 24 * 60 * 60 * 1000;

export async function shipmentLifecycle(
  input: ShipmentWorkflowInput,
): Promise<string> {
  const { raiseException } = proxyActivities<typeof activities>({
    startToCloseTimeout: "1 minute",
    retry: { maximumAttempts: 5 },
  });

  let departed = false;
  let arrived = false;
  let released = false;
  let delivered = false;
  let cancelled = false;

  setHandler(milestoneSignal, (signal) => {
    switch (signal.type) {
      case "vessel.departed":
        departed = true;
        break;
      case "vessel.arrived":
      case "container.discharged":
        arrived = true;
        break;
      case "entry.released":
        released = true;
        break;
      case "pod.confirmed":
        delivered = true;
        break;
    }
  });
  setHandler(cancelSignal, () => {
    cancelled = true;
  });
  setHandler(statusQuery, () =>
    delivered
      ? "DELIVERED"
      : cancelled
        ? "CANCELLED"
        : released
          ? "RELEASED"
          : arrived
            ? "ARRIVED"
            : departed
              ? "IN_TRANSIT"
              : "BOOKED",
  );

  const departureSla = (input.departureSlaDays ?? 14) * DAY_MS;
  const transitBudget =
    ((input.transitDays ?? 30) + (input.arrivalGraceDays ?? 7)) * DAY_MS;
  const releaseSla = (input.customsReleaseSlaDays ?? 10) * DAY_MS;

  // Phase 1: awaiting departure.
  if (!(await condition(() => departed || cancelled, departureSla))) {
    await raiseException(
      input.shipmentId,
      input.tenantId,
      "CONGESTION_DELAY",
      `No departure ${input.departureSlaDays ?? 14} days after booking`,
    );
    await condition(() => departed || cancelled);
  }
  if (cancelled) return "CANCELLED";

  // Phase 2: in transit.
  if (!(await condition(() => arrived || cancelled, transitBudget))) {
    await raiseException(
      input.shipmentId,
      input.tenantId,
      "CONGESTION_DELAY",
      "Transit time exceeded plan — vessel not arrived",
    );
    await condition(() => arrived || cancelled);
  }
  if (cancelled) return "CANCELLED";

  // Phase 3: customs at destination.
  if (!(await condition(() => released || delivered || cancelled, releaseSla))) {
    await raiseException(
      input.shipmentId,
      input.tenantId,
      "CUSTOMS_QUERY",
      `No customs release ${input.customsReleaseSlaDays ?? 10} days after arrival`,
    );
  }

  // Phase 4: delivery.
  await condition(() => delivered || cancelled);
  return cancelled ? "CANCELLED" : "DELIVERED";
}
