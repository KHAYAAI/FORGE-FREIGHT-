import { z } from "zod";

/**
 * Validates config/autonomy-policy.yaml.
 *
 * Only the LIVE sections are parsed strictly — those are read by running
 * code, so a malformed number there is a boot-time failure, exactly like an
 * invalid environment variable in config.ts. The `not_yet_enforced` and
 * `paging` sections are parsed loosely (passthrough) because nothing in this
 * codebase reads them yet; validating them strictly would make the API
 * refuse to start over a typo in a section that cannot affect behaviour.
 */
export const AutonomyPolicySchema = z.object({
  shipment_sla: z.object({
    departure_days: z.number().int().positive(),
    arrival_grace_days: z.number().int().nonnegative(),
    fallback_transit_days: z.number().int().positive(),
    customs_release_days: z.number().int().positive(),
  }),

  carrier_confirmation: z.object({
    backoff_hours: z.array(z.number().int().positive()).min(1),
  }),

  sanctions_rescreening: z.object({
    clear_after_days: z.number().int().positive(),
    review_or_hit_after_days: z.number().int().positive(),
    max_per_run: z.number().int().positive(),
  }),

  // Not read by any service today — see the file's own header. Kept loose.
  paging: z.record(z.string(), z.unknown()).optional(),
  not_yet_enforced: z.record(z.string(), z.unknown()).optional(),
});

export type AutonomyPolicy = z.infer<typeof AutonomyPolicySchema>;
