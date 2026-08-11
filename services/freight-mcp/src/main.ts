import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FreightClient } from "./client.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

/**
 * Entry point. Speaks MCP over stdio, which is what a local agent connects to.
 *
 * Logs go to stderr: stdout is the protocol channel, and writing anything else
 * there corrupts the stream.
 */
const config = loadConfig();
const client = new FreightClient(config);
const server = buildServer(client);

await server.connect(new StdioServerTransport());
console.error(
  JSON.stringify({
    at: new Date().toISOString(),
    msg: "freight-mcp ready",
    api: config.apiUrl,
    agent: config.agentId,
    mode: "read-only",
  }),
);
