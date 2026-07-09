import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CONFIG, type AppConfig } from "../../config.js";
import { JwtAuthGuard, TOKEN_VERIFIER } from "./jwt.guard.js";
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
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}
