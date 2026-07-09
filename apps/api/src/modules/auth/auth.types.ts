export interface AuthContext {
  /** FORGE Freight tenant this request is scoped to. Never trust the body for this. */
  tenantId: string;
  userId: string;
  roles: string[];
}

export const AUTH_CONTEXT_KEY = "forgeAuth";
