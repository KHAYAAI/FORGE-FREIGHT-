import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ZodExceptionFilter } from "./common/zod-exception.filter.js";
import { loadConfig } from "./config.js";

async function bootstrap() {
  const cfg = loadConfig(); // fail fast on invalid config, before Nest boots
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ZodExceptionFilter());
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
