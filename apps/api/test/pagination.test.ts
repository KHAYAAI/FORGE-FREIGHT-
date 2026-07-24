import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from "../src/modules/shipments/pagination.js";

const row = {
  createdAt: new Date("2026-07-15T09:30:00.000Z"),
  id: "3f1a2b4c-5d6e-4f70-8091-a2b3c4d5e6f7",
};

describe("keyset cursors", () => {
  it("round-trips a row position", () => {
    const decoded = decodeCursor(encodeCursor(row));
    expect(decoded.id).toBe(row.id);
    expect(decoded.createdAt.toISOString()).toBe(row.createdAt.toISOString());
  });

  it("survives a URL round-trip", () => {
    const cursor = encodeCursor(row);
    // base64url is chosen precisely so this is a no-op; a plain base64 cursor
    // would come back with "+" turned into a space and fail to decode.
    expect(encodeURIComponent(cursor)).toBe(cursor);
    expect(decodeCursor(decodeURIComponent(encodeURIComponent(cursor))).id).toBe(row.id);
  });

  it("preserves sub-second ordering", () => {
    // Two shipments booked in the same second must still be separable, or a
    // page boundary landing between them repeats or skips a row.
    const a = encodeCursor({ ...row, createdAt: new Date("2026-07-15T09:30:00.100Z") });
    const b = encodeCursor({ ...row, createdAt: new Date("2026-07-15T09:30:00.900Z") });
    expect(a).not.toBe(b);
    expect(decodeCursor(b).createdAt.getTime() - decodeCursor(a).createdAt.getTime()).toBe(800);
  });

  it.each([
    ["not base64 at all", "!!!!"],
    ["no separator", Buffer.from("nonsense").toString("base64url")],
    ["unparseable date", Buffer.from(`never|${row.id}`).toString("base64url")],
    ["id that isn't a uuid", Buffer.from("2026-07-15T09:30:00.000Z|../../etc").toString("base64url")],
    ["empty", ""],
  ])("rejects a %s cursor", (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(BadRequestException);
  });
});

describe("parseLimit", () => {
  it("defaults when absent or empty", () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit("")).toBe(DEFAULT_PAGE_SIZE);
  });

  it("accepts the documented range", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit(String(MAX_PAGE_SIZE))).toBe(MAX_PAGE_SIZE);
  });

  it.each(["0", "-5", "1.5", "abc", String(MAX_PAGE_SIZE + 1)])(
    "rejects %s rather than silently clamping",
    (raw) => {
      expect(() => parseLimit(raw)).toThrow(BadRequestException);
    },
  );
});
