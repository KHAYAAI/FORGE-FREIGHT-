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
}

bootstrap();
