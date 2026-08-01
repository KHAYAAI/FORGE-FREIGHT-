import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CONFIG, type AppConfig } from "../../config.js";
import { JwtAuthGuard, TOKEN_VERIFIER } from "./jwt.guard.js";
import { RolesGuard } from "./roles.js";
import { TokenVerifier } from "./token-verifier.js";

@Global()
@Module({
  providers: [
    {
      provide: TOKEN_VERIFIER,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig): TokenVerifier | null =>
        cfg.AUTH_MODE === "jwt"
          ? new TokenVerifier(cfg, undefined, cfg.jwksUrl)
          : null,
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Registered after the JWT guard so the auth context exists by the time
    // this one reads it — Nest runs global guards in registration order.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}
