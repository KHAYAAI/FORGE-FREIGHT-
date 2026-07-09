import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { AUTH_CONTEXT_KEY, type AuthContext } from "./auth.types.js";

/** Injects the verified AuthContext set by JwtAuthGuard. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    const auth = req[AUTH_CONTEXT_KEY] as AuthContext | undefined;
    if (!auth) {
      // Guard always runs first; reaching here is a wiring bug, not a user error.
      throw new Error("AuthContext missing — is JwtAuthGuard registered globally?");
    }
    return auth;
  },
);
