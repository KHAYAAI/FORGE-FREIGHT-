import type { Db } from "@forge-freight/db";
import type { TemporalService } from "../temporal/temporal.service.js";
import type { EventHandler, StoredEvent } from "./event-dispatcher.service.js";

const MILESTONES = new Set([
  "vessel.departed",
  "vessel.arrived",
  "container.discharged",
  "entry.released",
  "pod.confirmed",
]);

/** Forwards milestone events to the shipment's Temporal workflow as signals. */
export class WorkflowSignaler implements EventHandler {
  readonly name = "workflow-signaler";

  constructor(private readonly temporal: TemporalService) {}

  async handle(event: StoredEvent, _db: Db): Promise<void> {
    if (!event.shipmentId || !MILESTONES.has(event.type)) return;
    if (!this.temporal.enabled) return;
    await this.temporal.signalMilestone(event.shipmentId, event.type, event.occurredAt);
  }
}
