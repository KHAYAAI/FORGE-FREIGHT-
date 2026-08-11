import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { GlobalExceptionFilter } from "./common/global-exception.filter.js";
import { loadConfig } from "./config.js";

async function bootstrap() {
  const cfg = loadConfig(); // fail fast on invalid config, before Nest boots
  const app = await NestFactory.create(AppModule);

  // One filter, deliberately: Nest evaluates global filters in reverse
  // registration order, so a second, more specific one would have to be
  // registered *after* this to take effect. See the filter's own note.
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.use(
    helmet({
      // JSON API, not a browser page — CSP is the web app's job, not this one's.
      contentSecurityPolicy: false,
    }),
  );

  // Behind a reverse proxy in production (Caddy/Traefik in front of :3001);
  // without this every request looks like it comes from the proxy's IP,
  // which defeats both audit logging and the throttler's per-IP buckets.
  if (cfg.NODE_ENV === "production") {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }

  app.enableCors({
    origin: cfg.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();
  await app.listen(cfg.PORT);
  console.log(
    `FORGE Freight API listening on :${cfg.PORT} (auth=${cfg.AUTH_MODE}, outbox=${cfg.KAFKA_BROKERS ? "on" : "off"})`,
  );

  // The SLA sweep, carrier-confirmation chase and sanctions re-screen all run
  // unattended on a schedule (see infrastructure/kestra/) and raise exceptions
  // or escalations that today land ONLY on the ops kanban
  // (GET /ops/exceptions) unless Novu is configured — NotificationsService
  // degrades silently by design. That silence is fine for a screen someone is
  // watching; it is a real gap for a compliance HIT at 3am. This is loud on
  // purpose: config/autonomy-policy.yaml cannot fix this, only NOVU_API_KEY
  // (plus a real workflow on the Novu dashboard) can.
  if (!cfg.NOVU_API_KEY) {
    console.warn(
      "[paging] NOVU_API_KEY is not set. Scheduled automations (SLA sweep, " +
        "carrier confirmation, sanctions re-screening) will raise exceptions " +
        "that are visible ONLY on the ops kanban — nobody is paged. See " +
        "config/autonomy-policy.yaml, section 'paging', before relying on " +
        "any of these in production.",
    );
  }
}

bootstrap();
