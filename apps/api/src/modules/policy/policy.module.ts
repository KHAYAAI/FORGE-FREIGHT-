import { Module } from "@nestjs/common";
import { AutonomyPolicyService } from "./autonomy-policy.service.js";

/**
 * `AutonomyPolicyService` is constructed via its own static `.load()`
 * (file read + validation) rather than Nest's default constructor injection.
 * `NestFactory.create()` instantiates eager providers — this one included —
 * before `main.ts` calls `app.listen()`, so a missing or malformed
 * `config/autonomy-policy.yaml` crashes boot before the API serves a single
 * request. Same fail-fast guarantee `loadConfig()` gives environment
 * variables, achieved without a second loading path in main.ts.
 */
@Module({
  providers: [
    {
      provide: AutonomyPolicyService,
      useFactory: () => AutonomyPolicyService.load(),
    },
  ],
  exports: [AutonomyPolicyService],
})
export class PolicyModule {}
