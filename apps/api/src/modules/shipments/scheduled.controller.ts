import { Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { IngestKeyGuard } from "../ingest/ingest.controller.js";
import { SlaSweepService, type SweepResult } from "./sla-sweep.service.js";

/**
 * Endpoints a scheduler calls. Not a human surface.
 *
 * Authenticated machine-to-machine with the same `x-api-key` the tracking
 * adapters use: one shared machine secret is easier to rotate correctly than
 * several, and both callers are trusted infrastructure rather than tenants.
 * There is deliberately no tenant scope here — a sweep runs across the book,
 * and the events it appends carry the tenant of the shipment they concern.
 *
 * Everything here must be safe to call twice. The scheduler is allowed to be
 * unreliable; that is the whole reason this is a sweep and not a workflow.
 */
@Controller("scheduled")
@UseGuards(IngestKeyGuard)
export class ScheduledController {
  constructor(
    @Inject(SlaSweepService) private readonly slaSweep: SlaSweepService,
  ) {}

  /**
   * Raise an exception for every shipment that has passed an SLA without the
   * milestone that should have cleared it.
   *
   * Returns what it found so the caller's run log is a useful record — Kestra
   * shows the response body on the execution, which means "what did the sweep
   * do at 03:00 last Tuesday" is answerable without opening the database.
   */
  @Post("sla-sweep")
  @HttpCode(200)
  async slaSweepRun(): Promise<SweepResult> {
    return this.slaSweep.sweep();
  }
}
