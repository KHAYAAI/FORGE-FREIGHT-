import { Controller, Get, Module } from "@nestjs/common";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { status: "ok", service: "forge-freight-api" };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
