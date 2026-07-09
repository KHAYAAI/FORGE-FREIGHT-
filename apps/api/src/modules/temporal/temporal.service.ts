import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Client, Connection, WorkflowIdReusePolicy } from "@temporalio/client";
import { CONFIG, type AppConfig } from "../../config.js";

export const TASK_QUEUE = "shipment-lifecycle";

/**
 * Thin Temporal client. Disabled when TEMPORAL_ADDRESS is unset (dev without
 * the server) — the lifecycle projector still maintains projections from
 * events; only the time-based exception escalation is lost. Production
 * config requires TEMPORAL_ADDRESS.
 */
@Injectable()
export class TemporalService implements OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private client: Client | null = null;
  private connecting: Promise<Client | null> | null = null;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.cfg.TEMPORAL_ADDRESS);
  }

  private async getClient(): Promise<Client | null> {
    if (!this.enabled) return null;
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      try {
        const connection = await Connection.connect({
          address: this.cfg.TEMPORAL_ADDRESS,
        });
        this.client = new Client({
          connection,
          namespace: this.cfg.TEMPORAL_NAMESPACE,
        });
        return this.client;
      } catch (err) {
        this.logger.error(
          `Temporal connect failed: ${err instanceof Error ? err.message : err}`,
        );
        this.connecting = null;
        return null;
      }
    })();
    return this.connecting;
  }

  workflowId(shipmentId: string): string {
    return `shipment-${shipmentId}`;
  }

  async startShipmentLifecycle(input: {
    shipmentId: string;
    tenantId: string;
    transitDays: number | null;
  }): Promise<string | null> {
    const client = await this.getClient();
    if (!client) return null;
    const workflowId = this.workflowId(input.shipmentId);
    await client.workflow.start("shipmentLifecycle", {
      taskQueue: TASK_QUEUE,
      workflowId,
      workflowIdReusePolicy: WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
      args: [input],
    });
    this.logger.log(`Started lifecycle workflow ${workflowId}`);
    return workflowId;
  }

  /** Forward a milestone event to the shipment's workflow (fire-and-forget). */
  async signalMilestone(shipmentId: string, type: string, occurredAt: Date) {
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.workflow
        .getHandle(this.workflowId(shipmentId))
        .signal("milestone", { type, occurredAt: occurredAt.toISOString() });
    } catch (err) {
      // Workflow may have completed or never started (dev data) — not fatal.
      this.logger.warn(
        `Signal ${type} to ${shipmentId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.client?.connection.close();
  }
}
