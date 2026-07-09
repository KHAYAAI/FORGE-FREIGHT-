import { z } from "zod";

/**
 * All environment configuration, validated once at boot. The process refuses
 * to start on invalid config — no silent fallbacks in production.
 */
const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z
      .string()
      .url()
      .default("postgres://forge:forge@localhost:5432/forge_freight"),
    CORS_ORIGINS: z.string().default("http://localhost:3000"),

    /** jwt = verify against Keycloak JWKS. dev = trust x-dev-* headers. */
    AUTH_MODE: z.enum(["jwt", "dev"]).default("jwt"),
    /** e.g. http://localhost:8080/realms/forge-freight */
    AUTH_ISSUER: z.string().url().optional(),
    /** Defaults to <issuer>/protocol/openid-connect/certs (Keycloak layout). */
    AUTH_JWKS_URL: z.string().url().optional(),
    AUTH_AUDIENCE: z.string().optional(),
    /** JWT claim carrying the FORGE Freight tenant id. */
    AUTH_TENANT_CLAIM: z.string().default("tenant_id"),

    /** Comma-separated brokers, e.g. localhost:19092. Empty = relay disabled. */
    KAFKA_BROKERS: z.string().default(""),
    KAFKA_TOPIC_EVENTS: z.string().default("freight.events"),
    OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(500),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === "production") {
      if (cfg.AUTH_MODE !== "jwt") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "AUTH_MODE must be 'jwt' in production",
          path: ["AUTH_MODE"],
        });
      }
      if (!cfg.AUTH_ISSUER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "AUTH_ISSUER is required in production",
          path: ["AUTH_ISSUER"],
        });
      }
      if (!cfg.KAFKA_BROKERS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "KAFKA_BROKERS is required in production (outbox relay)",
          path: ["KAFKA_BROKERS"],
        });
      }
    }
    if (cfg.AUTH_MODE === "jwt" && !cfg.AUTH_ISSUER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AUTH_ISSUER is required when AUTH_MODE=jwt",
        path: ["AUTH_ISSUER"],
      });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema> & { jwksUrl: string | null };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.parse(env);
  const jwksUrl =
    parsed.AUTH_JWKS_URL ??
    (parsed.AUTH_ISSUER
      ? `${parsed.AUTH_ISSUER.replace(/\/$/, "")}/protocol/openid-connect/certs`
      : null);
  return { ...parsed, jwksUrl };
}

export const CONFIG = Symbol("CONFIG");
