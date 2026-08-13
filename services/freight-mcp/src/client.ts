import { randomUUID } from "node:crypto";
import { kindFromStatus, ToolError } from "./errors.js";
import type { McpConfig } from "./config.js";

export type FetchLike = typeof fetch;

export interface CallOptions {
  /** Query parameters; undefined values are dropped rather than sent as "undefined". */
  query?: Record<string, string | number | undefined>;
}

/**
 * HTTP client for the Freight Core API.
 *
 * Every call is GET. That is not a convention here, it is the whole security
 * posture: the tool registry has no non-GET entry and there is no method
 * parameter to pass one, so the agent cannot mutate anything through this
 * server regardless of configuration. See `hermes/TOOLS.md`.
 */
export class FreightClient {
  constructor(
    private readonly cfg: McpConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly log: (line: Record<string, unknown>) => void = (l) =>
      console.error(JSON.stringify(l)),
  ) {}

  async get<T = unknown>(path: string, opts: CallOptions = {}): Promise<T> {
    const correlationId = randomUUID();
    const url = new URL(this.cfg.apiUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);

    try {
      const res = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          "x-agent-key": this.cfg.agentKey,
          "x-agent-tenant-id": this.cfg.tenantId,
          // Both ends log this, so "what did the agent do at 14:02" is
          // answerable by grep rather than by inference.
          "x-correlation-id": correlationId,
          "x-agent-id": this.cfg.agentId,
          accept: "application/json",
        },
        signal: controller.signal,
      });

      const ms = Date.now() - started;
      // The key is never logged; the path, the outcome and the id are.
      this.log({
        at: new Date().toISOString(),
        agent: this.cfg.agentId,
        path,
        status: res.status,
        ms,
        correlationId,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ToolError(
          kindFromStatus(res.status),
          `Freight Core returned ${res.status} for ${path}`,
          correlationId,
          body.slice(0, 500) || undefined,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof ToolError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ToolError(
          "UPSTREAM",
          `Freight Core did not answer ${path} within ${this.cfg.timeoutMs}ms`,
          correlationId,
        );
      }
      throw new ToolError(
        "UPSTREAM",
        `Could not reach Freight Core: ${err instanceof Error ? err.message : String(err)}`,
        correlationId,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
