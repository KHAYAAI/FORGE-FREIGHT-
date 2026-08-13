import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FreightClient } from "./client.js";
import { loadConfig } from "./config.js";
import { serveHttp } from "./http-server.js";
import { buildServer } from "./server.js";

/**
 * Entry point. Two transports, selected by `MCP_TRANSPORT` (default stdio):
 *
 * - stdio: a locally-spawned agent process talks to this over its own
 *   stdin/stdout — `claude mcp add freight -- node dist/main.js`. Logs go to
 *   stderr; stdout is the protocol channel, and writing anything else there
 *   corrupts the stream.
 * - http: a persistent StreamableHTTP server, for a remote agent host. This
 *   is the mode `infra/aws/mcp.tf` runs on ECS Fargate.
 */
const config = loadConfig();
const client = new FreightClient(config);

if (config.transport === "http") {
  serveHttp(client, config.httpPort);
} else {
  const server = buildServer(client);
  await server.connect(new StdioServerTransport());
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      msg: "freight-mcp ready",
      api: config.apiUrl,
      agent: config.agentId,
      transport: "stdio",
      mode: "read-only",
    }),
  );
}
