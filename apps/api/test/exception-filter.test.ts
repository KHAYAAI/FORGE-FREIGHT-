import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GlobalExceptionFilter } from "../src/common/global-exception.filter.js";

/**
 * These exist because the API spent its whole life answering `500` to every
 * malformed request: the specific `@Catch(ZodError)` filter was registered
 * before the catch-all, and Nest evaluates global filters in reverse. Nothing
 * caught it, because nothing asserted on the *status* a bad body produces.
 */
function capture() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

const filter = new GlobalExceptionFilter();

describe("GlobalExceptionFilter", () => {
  it("answers 400 with field paths for a validation failure", () => {
    const { host, status, json } = capture();
    const schema = z.object({ origin: z.string().length(5), qty: z.number().int() });
    const err = schema.safeParse({ origin: "DURBAN", qty: 1.5 }).error!;

    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0]![0] as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path).sort()).toEqual(["origin", "qty"]);
  });

  it("passes an HttpException's own status and body through", () => {
    const { host, status, json } = capture();
    filter.catch(new ForbiddenException("not yours"), host);
    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0]![0]).toMatchObject({ message: "not yours" });
  });

  it("wraps a 400 raised as an HttpException without losing it", () => {
    const { host, status } = capture();
    filter.catch(new BadRequestException("nope"), host);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("never leaks an unexpected error's message to the caller", () => {
    const { host, status, json } = capture();
    filter.catch(new Error("connection string: postgres://user:hunter2@db/prod"), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls[0]![0])).not.toContain("hunter2");
  });
});
