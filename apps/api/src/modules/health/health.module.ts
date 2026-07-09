import { Controller, Get, Inject, Module, ServiceUnavailableException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "@forge-freight/db";
import { DB } from "../db/db.module.js";

@Controller("health")
class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Liveness: the process is up. */
  @Get()
  health() {
    return { status: "ok", service: "forge-freight-api" };
  }

  /** Readiness: we can reach the database. */
  @Get("ready")
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: "unready", database: "down" });
    }
    return { status: "ready", database: "up" };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
