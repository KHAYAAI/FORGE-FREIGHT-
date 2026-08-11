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
  /** Service credential presented to the API. Never logged. */
  apiKey: string;
  /** Per-request ceiling. A hung upstream must not hang a reasoning loop. */
  timeoutMs: number;
  /** Identifies this agent in the API's audit trail. */
  agentId: string;
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

export function loadConfig(env = process.env): McpConfig {
  const saved = process.env;
  process.env = env;
  try {
    return {
      apiUrl: required("FREIGHT_API_URL").replace(/\/+$/, ""),
      apiKey: required("FREIGHT_MCP_API_KEY"),
      timeoutMs: Number(env.FREIGHT_MCP_TIMEOUT_MS ?? 30_000),
      agentId: env.FREIGHT_MCP_AGENT_ID?.trim() || "hermes",
    };
  } finally {
    process.env = saved;
  }
}
