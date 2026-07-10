import { Inject, Injectable, Logger } from "@nestjs/common";
import { CONFIG, type AppConfig } from "../../config.js";

const NOVU_TRIGGER_URL = "https://api.novu.co/v1/events/trigger";

export interface NotificationSubscriber {
  subscriberId: string;
  email?: string | null;
  phone?: string | null;
}

/**
 * Novu trigger client — plain REST, not the SDK. Novu's `/v1/events/trigger`
 * contract has stayed stable across SDK major-version churn; a fetch call
 * is fewer moving parts than pinning an SDK version, and this is the only
 * endpoint we need. Which channel actually fires (WhatsApp, SMS, email) is
 * decided by the workflow's own configuration in the Novu dashboard, not
 * here — this just supplies subscriber identity and payload data.
 *
 * Degrades like every other optional integration in this codebase: no
 * NOVU_API_KEY means notifications are logged and skipped, never a hard
 * failure that blocks the event pipeline.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  /** Default workflow for shipment milestones — configurable via NOVU_WORKFLOW_ID. */
  get milestoneWorkflowId(): string {
    return this.cfg.NOVU_WORKFLOW_ID;
  }

  get enabled(): boolean {
    return Boolean(this.cfg.NOVU_API_KEY);
  }

  async trigger(
    workflowId: string,
    to: NotificationSubscriber,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.enabled) {
      this.logger.debug(`NOVU_API_KEY unset — skipping '${workflowId}' for ${to.subscriberId}`);
      return false;
    }
    if (!to.email && !to.phone) {
      this.logger.warn(`No email or phone for subscriber ${to.subscriberId} — nothing to notify`);
      return false;
    }

    try {
      const res = await fetch(NOVU_TRIGGER_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `ApiKey ${this.cfg.NOVU_API_KEY}`,
        },
        body: JSON.stringify({
          name: workflowId,
          to: {
            subscriberId: to.subscriberId,
            email: to.email ?? undefined,
            phone: to.phone ?? undefined,
          },
          payload,
        }),
      });
      if (!res.ok) {
        this.logger.error(`Novu trigger failed (${res.status}): ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      // A notification-provider outage is not a reason to fail the event
      // pipeline — log and move on, same posture as yente/Anthropic.
      this.logger.error(`Novu trigger request failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
