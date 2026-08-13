import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FreightClient } from "./client.js";
import { buildServer } from "./server.js";

/**
 * Runs freight-mcp as a persistent StreamableHTTP server, for a remote agent
 * host — this is what ECS Fargate runs, since Fargate cannot give a
 * container an interactive stdio channel the way a locally-spawned child
 * process can. Local development keeps using stdio; nothing here changes
 * that path (see main.ts).
 *
 * Stateless by design: a new `Server` and a new
 * `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` are
 * built for every request and discarded after. Read-only tool calls are
 * independent of each other — there is no multi-turn conversation state
 * this server needs to hold — so a session store would be complexity with
 * nothing to justify it, and a fresh pair per request is the SDK's
 * documented safe pattern for exactly this shape of server.
 */
export function serveHttp(client: FreightClient, port: number): void {
  const httpServer = createServer((req, res) => {
    void handle(req, res, client);
  });
  httpServer.listen(port, () => {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        msg: "freight-mcp listening",
        port,
        path: "/mcp",
        mode: "read-only",
      }),
    );
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  client: FreightClient,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }

  try {
    const body = req.method === "POST" ? await readJsonBody(req) : undefined;
    const server = buildServer(client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    // A malformed request body or a transport-level failure — the tool-level
    // errors in errors.ts are a separate concern and already handled inside
    // server.ts before anything reaches here.
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        msg: "freight-mcp request failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    if (!res.headersSent) res.writeHead(500).end();
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}
