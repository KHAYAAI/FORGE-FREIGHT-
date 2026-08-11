/**
 * Errors an agent can act on differently.
 *
 * A reasoning loop that cannot tell these apart will retry the wrong ones —
 * hammering a lane that will never exist, or giving up on a blip. So the
 * distinction is part of the contract, not an implementation detail.
 */
export type ToolErrorKind =
  /** The thing asked for does not exist. Do not retry; the answer will not change. */
  | "NOT_FOUND"
  /** This credential may not see it. Do not retry; escalate to a human. */
  | "NOT_PERMITTED"
  /** A feature or integration is switched off. Not a fault, and not retryable. */
  | "NOT_CONFIGURED"
  /** The upstream failed or timed out. Retryable. */
  | "UPSTREAM"
  /** The arguments were wrong. The agent's own mistake; fix and re-ask. */
  | "INVALID_INPUT";

export class ToolError extends Error {
  constructor(
    readonly kind: ToolErrorKind,
    message: string,
    readonly correlationId?: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }

  /** Retrying is only ever worth it for one of these. */
  get retryable(): boolean {
    return this.kind === "UPSTREAM";
  }

  /**
   * What the agent sees. The correlation id is included deliberately: when a
   * person is asked to explain what an agent did, "it failed" is useless and
   * a id that appears in both the MCP log and the API log is not.
   */
  toPayload() {
    return {
      error: this.kind,
      message: this.message,
      retryable: this.retryable,
      correlationId: this.correlationId ?? null,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

/** Map an HTTP status from the Freight Core onto something actionable. */
export function kindFromStatus(status: number): ToolErrorKind {
  if (status === 404) return "NOT_FOUND";
  if (status === 401 || status === 403) return "NOT_PERMITTED";
  if (status === 422 || status === 400) return "INVALID_INPUT";
  if (status === 501 || status === 503) return "NOT_CONFIGURED";
  return "UPSTREAM";
}
