import { describe, expect, it, vi } from "vitest";
import { FreightClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { kindFromStatus, ToolError } from "../src/errors.js";
import { TOOLS, UNAVAILABLE_TOOLS } from "../src/tools.js";

const CONFIG = {
  apiUrl: "http://core.test",
  agentKey: "secret-key-value",
  tenantId: "33333333-3333-3333-3333-333333333333",
  timeoutMs: 1000,
  agentId: "hermes-test",
  transport: "stdio" as const,
  httpPort: 9000,
};

const okResponse = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("the tool surface", () => {
  it("exposes every tool named in the contract", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      [
        "get_customer",
        "get_customs_entry",
        "get_documents",
        "get_integrations",
        "get_invoice",
        "get_invoice_findings",
        "get_margin_rules",
        "get_open_exceptions",
        "get_quote",
        "get_rate_cards",
        "get_shipment",
        "get_shipment_history",
        "list_shipments",
      ].sort(),
    );
  });

  it("gives every tool a description worth reading", () => {
    for (const t of TOOLS) {
      expect(t.description.length, `${t.name} needs a real description`).toBeGreaterThan(30);
    }
  });

  it("names no write tool", () => {
    // The guarantee is structural — there is no method parameter anywhere in
    // this server — but a name like create_* slipping in would mean someone
    // had started down that road.
    for (const t of TOOLS) {
      expect(t.name).not.toMatch(/^(create|update|delete|book|accept|cancel|issue|post)_/);
    }
  });

  it("explains what an unbuilt tool waits on rather than just refusing", () => {
    for (const [name, reason] of Object.entries(UNAVAILABLE_TOOLS)) {
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(30);
    }
  });
});

describe("read-only is a property of the code, not a setting", () => {
  it("issues GET for every tool, with no way to ask for anything else", async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return okResponse();
    }) as unknown as typeof fetch;

    const client = new FreightClient(CONFIG, fetchImpl, () => {});
    const uuid = "11111111-1111-1111-1111-111111111111";

    for (const tool of TOOLS) {
      const args = tool.input.safeParse({
        shipmentId: uuid,
        quoteId: uuid,
        partyId: uuid,
        invoiceId: uuid,
      });
      if (!args.success) continue;
      await tool.call(client, args.data as Record<string, never>);
    }

    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });

  it("never sends a request body", async () => {
    let sawBody = false;
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init && "body" in init && init.body != null) sawBody = true;
      return okResponse();
    }) as unknown as typeof fetch;

    const client = new FreightClient(CONFIG, fetchImpl, () => {});
    await client.get("/shipments");
    expect(sawBody).toBe(false);
  });
});

describe("the client", () => {
  it("sends the credential, the agent and a correlation id", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return okResponse();
    }) as unknown as typeof fetch;

    await new FreightClient(CONFIG, fetchImpl, () => {}).get("/shipments");

    expect(headers["x-agent-key"]).toBe("secret-key-value");
    expect(headers["x-agent-tenant-id"]).toBe(CONFIG.tenantId);
    expect(headers["x-agent-id"]).toBe("hermes-test");
    expect(headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives each call its own correlation id", async () => {
    const ids: string[] = [];
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      ids.push((init?.headers as Record<string, string>)["x-correlation-id"]!);
      return okResponse();
    }) as unknown as typeof fetch;

    const client = new FreightClient(CONFIG, fetchImpl, () => {});
    await client.get("/shipments");
    await client.get("/shipments");
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("never writes the credential to the log", async () => {
    const lines: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async () => okResponse()) as unknown as typeof fetch;

    await new FreightClient(CONFIG, fetchImpl, (l) => lines.push(l)).get("/shipments");

    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0])).not.toContain("secret-key-value");
    expect(lines[0]).toMatchObject({ path: "/shipments", status: 200 });
    expect(lines[0]!.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("drops undefined query parameters instead of sending the string", async () => {
    let url = "";
    const fetchImpl = vi.fn(async (u: string) => {
      url = u;
      return okResponse();
    }) as unknown as typeof fetch;

    await new FreightClient(CONFIG, fetchImpl, () => {}).get("/shipments", {
      query: { limit: 10, cursor: undefined },
    });

    expect(url).toContain("limit=10");
    expect(url).not.toContain("cursor");
  });

  it("times out rather than hanging a reasoning loop", async () => {
    const fetchImpl = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    ) as unknown as typeof fetch;

    const client = new FreightClient({ ...CONFIG, timeoutMs: 20 }, fetchImpl, () => {});
    const err = await client.get("/shipments").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe("UPSTREAM");
    expect((err as ToolError).retryable).toBe(true);
  });
});

describe("errors an agent can act on", () => {
  it.each([
    [404, "NOT_FOUND", false],
    [403, "NOT_PERMITTED", false],
    [401, "NOT_PERMITTED", false],
    [422, "INVALID_INPUT", false],
    [503, "NOT_CONFIGURED", false],
    [500, "UPSTREAM", true],
  ])("maps %i to %s (retryable: %s)", async (status, kind, retryable) => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", { status }),
    ) as unknown as typeof fetch;

    const client = new FreightClient(CONFIG, fetchImpl, () => {});
    const err = (await client.get("/x").catch((e: unknown) => e)) as ToolError;

    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
    expect(err.toPayload().correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("classifies statuses directly too", () => {
    expect(kindFromStatus(404)).toBe("NOT_FOUND");
    expect(kindFromStatus(502)).toBe("UPSTREAM");
  });
});

describe("configuration", () => {
  const TENANT = "44444444-4444-4444-4444-444444444444";
  const BASE = { FREIGHT_API_URL: "http://x", FREIGHT_MCP_AGENT_KEY: "k", FREIGHT_MCP_TENANT_ID: TENANT };

  it("refuses to start without an API url", () => {
    expect(() =>
      loadConfig({ FREIGHT_MCP_AGENT_KEY: "k", FREIGHT_MCP_TENANT_ID: TENANT } as NodeJS.ProcessEnv),
    ).toThrow(/FREIGHT_API_URL is required/);
  });

  it("refuses to start without a credential", () => {
    expect(() =>
      loadConfig({ FREIGHT_API_URL: "http://x", FREIGHT_MCP_TENANT_ID: TENANT } as NodeJS.ProcessEnv),
    ).toThrow(/FREIGHT_MCP_AGENT_KEY is required/);
  });

  it("refuses to start without a tenant id", () => {
    expect(() =>
      loadConfig({ FREIGHT_API_URL: "http://x", FREIGHT_MCP_AGENT_KEY: "k" } as NodeJS.ProcessEnv),
    ).toThrow(/FREIGHT_MCP_TENANT_ID is required/);
  });

  it("refuses a tenant id that is not a uuid — the whole point is binding to exactly one", () => {
    expect(() =>
      loadConfig({
        FREIGHT_API_URL: "http://x",
        FREIGHT_MCP_AGENT_KEY: "k",
        FREIGHT_MCP_TENANT_ID: "not-a-uuid",
      } as NodeJS.ProcessEnv),
    ).toThrow(/must be a uuid/);
  });

  it("defaults to stdio transport", () => {
    const cfg = loadConfig(BASE as NodeJS.ProcessEnv);
    expect(cfg.transport).toBe("stdio");
  });

  it("accepts http transport with a configurable port", () => {
    const cfg = loadConfig({ ...BASE, MCP_TRANSPORT: "http", MCP_HTTP_PORT: "9100" } as NodeJS.ProcessEnv);
    expect(cfg.transport).toBe("http");
    expect(cfg.httpPort).toBe(9100);
  });

  it("refuses an unrecognised transport", () => {
    expect(() => loadConfig({ ...BASE, MCP_TRANSPORT: "grpc" } as NodeJS.ProcessEnv)).toThrow(
      /MCP_TRANSPORT must be/,
    );
  });

  it("has no database setting to misuse", () => {
    const cfg = loadConfig(BASE as NodeJS.ProcessEnv);
    expect(Object.keys(cfg).sort()).toEqual(
      ["agentId", "agentKey", "apiUrl", "httpPort", "tenantId", "timeoutMs", "transport"].sort(),
    );
    expect(cfg.apiUrl).toBe("http://x");
  });
});
