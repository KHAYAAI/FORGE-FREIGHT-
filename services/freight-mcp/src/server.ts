import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { FreightClient } from "./client.js";
import { ToolError } from "./errors.js";
import { TOOLS, UNAVAILABLE_TOOLS, type ToolDef } from "./tools.js";

/** JSON Schema for a tool's arguments, from its zod shape. */
function inputSchema(def: ToolDef): Record<string, unknown> {
  const shape =
    def.input instanceof z.ZodObject
      ? (def.input.shape as Record<string, z.ZodTypeAny>)
      : {};
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const optional = value.isOptional();
    const inner = optional ? (value as z.ZodOptional<z.ZodTypeAny>).unwrap() : value;
    properties[key] =
      inner instanceof z.ZodNumber
        ? { type: "number" }
        : key.endsWith("Id")
          ? { type: "string", format: "uuid" }
          : { type: "string" };
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function buildServer(client: FreightClient): Server {
  const server = new Server(
    { name: "freight-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: inputSchema(t),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;

    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      // A tool that is planned but unbuilt gets a specific answer, so the
      // agent stops rather than substituting a different tool and passing the
      // result off as the one that was asked for.
      const reason = UNAVAILABLE_TOOLS[name];
      return errorResult(
        new ToolError(
          "NOT_CONFIGURED",
          reason
            ? `${name} is not available. ${reason}`
            : `${name} is not a tool on this server. It exposes read-only tools only.`,
        ),
      );
    }

    const parsed = tool.input.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return errorResult(
        new ToolError(
          "INVALID_INPUT",
          `Arguments for ${name} are not valid`,
          undefined,
          parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
        ),
      );
    }

    try {
      const data = await tool.call(client, parsed.data as Record<string, never>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return errorResult(
        err instanceof ToolError
          ? err
          : new ToolError(
              "UPSTREAM",
              err instanceof Error ? err.message : String(err),
            ),
      );
    }
  });

  return server;
}

/**
 * Failures come back as content with `isError`, not as protocol errors.
 *
 * The agent needs to reason about *why* something failed — whether to retry,
 * escalate, or stop — and a transport-level error gives it nothing to reason
 * with.
 */
function errorResult(err: ToolError) {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify(err.toPayload(), null, 2) },
    ],
  };
}
