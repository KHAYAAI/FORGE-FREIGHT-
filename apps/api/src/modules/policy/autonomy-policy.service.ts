import { readFileSync } from "node:fs";
import { Injectable, Logger } from "@nestjs/common";
import { parse as parseYaml } from "yaml";
import {
  AutonomyPolicySchema,
  type AutonomyPolicy,
} from "./autonomy-policy.schema.js";
import type { SlaThresholds } from "../shipments/sla-rules.js";

/**
 * Loads and validates config/autonomy-policy.yaml.
 *
 * Same discipline as `loadConfig()` in config.ts: parsed once, validated
 * strictly, and constructed via `AutonomyPolicyService.load()` — called from
 * main.ts before Nest boots — so a malformed policy file fails the process
 * immediately rather than surfacing as a wrong SLA threshold three weeks
 * later. There is no in-code fallback to the old hardcoded constants if the
 * file is missing: a business's operating boundaries must be a decision on
 * record, not an implicit default nobody chose.
 */
@Injectable()
export class AutonomyPolicyService {
  private readonly logger = new Logger(AutonomyPolicyService.name);

  private constructor(private readonly policy: AutonomyPolicy) {}

  static load(path = process.env.AUTONOMY_POLICY_PATH || "config/autonomy-policy.yaml"): AutonomyPolicyService {
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch (err) {
      throw new Error(
        `Could not read autonomy policy at '${path}'. The API refuses to ` +
          "start without it — see config/autonomy-policy.yaml for what it " +
          `must contain. (${err instanceof Error ? err.message : String(err)})`,
        { cause: err },
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(`'${path}' is not valid YAML: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }

    const result = AutonomyPolicySchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`'${path}' failed validation:\n${issues}`);
    }

    const svc = new AutonomyPolicyService(result.data);
    svc.logger.log(
      `Autonomy policy loaded from ${path} — SLA departure ${result.data.shipment_sla.departure_days}d, ` +
        `carrier chase ladder [${result.data.carrier_confirmation.backoff_hours.join(",")}]h, ` +
        `re-screen CLEAR every ${result.data.sanctions_rescreening.clear_after_days}d`,
    );
    return svc;
  }

  /** For SlaSweepService — see sla-rules.ts for how these are applied. */
  get slaThresholds(): SlaThresholds {
    const s = this.policy.shipment_sla;
    return {
      departureDays: s.departure_days,
      arrivalGraceDays: s.arrival_grace_days,
      fallbackTransitDays: s.fallback_transit_days,
      customsReleaseDays: s.customs_release_days,
    };
  }

  /** For CarrierConfirmationService — the ladder in carrier-confirmation-rules.ts. */
  get carrierConfirmationBackoffHours(): readonly number[] {
    return this.policy.carrier_confirmation.backoff_hours;
  }

  /** For RescreeningService — see rescreening-rules.ts. */
  get rescreenAfterDays(): { CLEAR: number; REVIEW: number; HIT: number; UNSCREENED: number } {
    const s = this.policy.sanctions_rescreening;
    return {
      UNSCREENED: 0,
      CLEAR: s.clear_after_days,
      REVIEW: s.review_or_hit_after_days,
      HIT: s.review_or_hit_after_days,
    };
  }

  get rescreenMaxPerRun(): number {
    return this.policy.sanctions_rescreening.max_per_run;
  }
}

export const AUTONOMY_POLICY = Symbol("AUTONOMY_POLICY");
