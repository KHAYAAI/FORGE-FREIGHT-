import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { BillingService } from "./billing.service.js";

/** Hourly. Being an hour late calling an invoice overdue costs nothing. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Moves unsettled invoices past their due date to `OVERDUE`.
 *
 * The status was in the enum from the start and the console already rendered
 * it — a red badge, its own filter, an "overdue" count on the invoices screen
 * — but nothing ever wrote it. The count was permanently zero, which is worse
 * than absent: the screen asserted that nothing was late.
 *
 * A sweep rather than a computed-on-read derivation because the status is a
 * stored column that the ledger feed and the notification dispatcher both key
 * off, so it has to actually change.
 */
@Injectable()
export class OverdueSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverdueSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  onModuleInit() {
    this.running = true;
    // Once at boot so a restart after downtime catches up immediately rather
    // than leaving the screen wrong for another hour.
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    if (!this.running) return;
    try {
      const n = await this.billing.markOverdue();
      if (n > 0) this.logger.log(`Marked ${n} invoice(s) overdue`);
    } catch (err) {
      // A database blip is operational weather — the next tick retries, and
      // the sweep is idempotent, so nothing is lost by skipping one.
      this.logger.error(`Overdue sweep failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
