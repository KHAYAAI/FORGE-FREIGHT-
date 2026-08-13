/**
 * Configuration, read from the environment only.
 *
 * There are no secrets in this source tree and no defaults that would let the
 * server start against something it should not. In particular there is no
 * DATABASE_URL here and no code that would use one: the MCP server is an HTTP
 * client against the Freight Core API, so tenant scoping, role checks and rate
 * limits apply to the agent exactly as they apply to a person.
 */
export interface McpConfig {
  /** Freight Core base URL, reachable from wherever this runs. */
  apiUrl: string;
  /**
   * Presented as `x-agent-key`, alongside `tenantId` as `x-agent-tenant-id`.
   * Must equal the API's own `AGENT_API_KEY` — see
   * `apps/api/src/modules/auth/jwt.guard.ts`. Never logged.
   */
  agentKey: string;
  /**
   * The one tenant this instance may read. "One instance per tenant," the
   * same shape `infrastructure/n8n` already uses for the same reason: a
   * malformed or hostile tool call cannot read across tenants when the
   * tenant is server-side configuration rather than something the caller
   * supplies.
   */
  tenantId: string;
  /** Per-request ceiling. A hung upstream must not hang a reasoning loop. */
  timeoutMs: number;
  /** Identifies this agent in the API's audit trail. */
  agentId: string;
  /**
   * `stdio` (default): speaks MCP over stdio, for a locally-spawned agent
   * process — `claude mcp add freight -- node dist/main.js`.
   * `http`: a persistent StreamableHTTP server, for a remote agent host —
   * this is the mode ECS Fargate runs, since Fargate cannot give a container
   * an interactive stdio channel the way a locally-spawned child process can.
   */
  transport: "stdio" | "http";
  /** Only read when transport is "http". */
  httpPort: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `${name} is required. The MCP server refuses to start without it — ` +
        "a server that guesses its credentials talks to the wrong system.",
    );
  }
  return v.trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadConfig(env = process.env): McpConfig {
  const saved = process.env;
  process.env = env;
  try {
    const tenantId = required("FREIGHT_MCP_TENANT_ID");
    if (!UUID.test(tenantId)) {
      throw new Error(
        `FREIGHT_MCP_TENANT_ID must be a uuid, got '${tenantId}'. This binds ` +
          "the server to one tenant's book — a malformed value is refused " +
          "rather than silently reaching for the wrong one.",
      );
    }
    const transport = env.MCP_TRANSPORT?.trim() || "stdio";
    if (transport !== "stdio" && transport !== "http") {
      throw new Error(`MCP_TRANSPORT must be 'stdio' or 'http', got '${transport}'`);
    }
    return {
      apiUrl: required("FREIGHT_API_URL").replace(/\/+$/, ""),
      agentKey: required("FREIGHT_MCP_AGENT_KEY"),
      tenantId,
      timeoutMs: Number(env.FREIGHT_MCP_TIMEOUT_MS ?? 30_000),
      agentId: env.FREIGHT_MCP_AGENT_ID?.trim() || "hermes",
      transport,
      httpPort: Number(env.MCP_HTTP_PORT ?? 9000),
    };
  } finally {
    process.env = saved;
  }
}
