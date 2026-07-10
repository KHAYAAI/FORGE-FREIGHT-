import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { GlobalExceptionFilter } from "./common/global-exception.filter.js";
import { ZodExceptionFilter } from "./common/zod-exception.filter.js";
import { loadConfig } from "./config.js";

async function bootstrap() {
  const cfg = loadConfig(); // fail fast on invalid config, before Nest boots
  const app = await NestFactory.create(AppModule);

  // Filters are tried in order; the specific one (Zod) must come before the
  // catch-all so validation errors keep their field-level detail.
  app.useGlobalFilters(new ZodExceptionFilter(), new GlobalExceptionFilter());

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
}

bootstrap();
