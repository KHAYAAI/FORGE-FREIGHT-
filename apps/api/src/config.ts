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

    /** Temporal server, e.g. localhost:7233. Empty = lifecycle timers disabled. */
    TEMPORAL_ADDRESS: z.string().default(""),
    TEMPORAL_NAMESPACE: z.string().default("default"),

    /** API key external tracking systems use on /ingest/* webhooks. */
    INGEST_API_KEY: z.string().default(""),

    /** yente screening endpoint, e.g. http://localhost:8000. Empty = dev skip. */
    YENTE_URL: z.string().default(""),

    /** Anthropic API key for document extraction. Empty = manual review only. */
    ANTHROPIC_API_KEY: z.string().default(""),
    ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),
    /** Extractions below this confidence require human review. */
    EXTRACTION_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
    DOC_STORAGE_DIR: z.string().default("./storage/documents"),

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
      if (!cfg.TEMPORAL_ADDRESS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "TEMPORAL_ADDRESS is required in production (lifecycle timers)",
          path: ["TEMPORAL_ADDRESS"],
        });
      }
      if (!cfg.INGEST_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "INGEST_API_KEY is required in production (tracking webhooks)",
          path: ["INGEST_API_KEY"],
        });
      }
      if (!cfg.YENTE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "YENTE_URL is required in production (sanctions screening)",
          path: ["YENTE_URL"],
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
