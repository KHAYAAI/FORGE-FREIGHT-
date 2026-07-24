import { BadRequestException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@forge-freight/db";
import { ShipmentsController } from "../src/modules/shipments/shipments.controller.js";
import {
  authFor,
  createShipments,
  createTenantFixture,
  dropTenantFixture,
  testDb,
  type Fixture,
} from "./harness.js";

/**
 * Keyset pagination against real SQL. The cursor comparison is a compound
 * `(created_at, id)` predicate; a mock can't tell you whether Postgres agrees
 * with the ordering you think you asked for, and a subtly wrong comparison
 * shows up as rows silently skipped between pages — the exact failure the
 * pagination was added to prevent.
 */

const TOTAL = 25;
let db: Db;
let fixture: Fixture;
let controller: ShipmentsController;

beforeAll(async () => {
  db = testDb();
  fixture = await createTenantFixture(db, "paging");
  controller = new ShipmentsController(db);

  const base = new Date("2026-07-01T00:00:00.000Z").getTime();
  await createShipments(
    db,
    fixture,
    Array.from({ length: TOTAL }, (_, i) => ({
      origin: "CNSHA",
      destination: "ZADUR",
      status: i % 5 === 0 ? ("DELIVERED" as const) : ("BOOKED" as const),
      // Deliberately coarse: several shipments share a timestamp, which is
      // what forces the id tiebreak in the cursor to do real work.
      createdAt: new Date(base + Math.floor(i / 3) * 60_000),
    })),
  );
});

afterAll(async () => {
  await dropTenantFixture(db, fixture);
});

/** Walks every page and returns the ids in order, with a runaway guard. */
async function drain(status?: string, limit = 7) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const page: Awaited<ReturnType<ShipmentsController["list"]>> = await controller.list(
      authFor(fixture),
      status,
      cursor,
      String(limit),
    );
    ids.push(...page.rows.map((r) => r.id));
    if (!page.nextCursor) return { ids, total: page.total };
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not terminate");
}

describe("shipment pagination", () => {
  it("walks the whole book exactly once, with no gaps or repeats", async () => {
    const { ids, total } = await drain();
    expect(total).toBe(TOTAL);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it("reports the full total on the first page, not the page size", async () => {
    const page = await controller.list(authFor(fixture), undefined, undefined, "5");
    expect(page.rows).toHaveLength(5);
    expect(page.total).toBe(TOTAL);
    expect(page.nextCursor).not.toBeNull();
  });

  it("orders newest first and keeps that order across a page boundary", async () => {
    const { ids } = await drain(undefined, 4);
    const rows = await controller.list(authFor(fixture), undefined, undefined, "200");
    const byId = new Map(rows.rows.map((r) => [r.id, r]));

    for (let i = 1; i < ids.length; i++) {
      const prev = byId.get(ids[i - 1]!)!;
      const next = byId.get(ids[i]!)!;
      const ordered =
        prev.createdAt > next.createdAt ||
        (prev.createdAt.getTime() === next.createdAt.getTime() && prev.id > next.id);
      expect(ordered, `${prev.id} should sort before ${next.id}`).toBe(true);
    }
  });

  it("applies the status filter to both the page and the total", async () => {
    const delivered = await drain("DELIVERED");
    expect(delivered.total).toBe(5);
    expect(delivered.ids).toHaveLength(5);
  });

  it("closes out the last page with a null cursor", async () => {
    const page = await controller.list(authFor(fixture), undefined, undefined, "200");
    expect(page.rows).toHaveLength(TOTAL);
    expect(page.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor instead of falling back to page one", async () => {
    // Silently ignoring a bad cursor would restart the walk from the top and
    // duplicate everything the caller had already seen.
    await expect(
      controller.list(authFor(fixture), undefined, "not-a-real-cursor"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an out-of-range limit", async () => {
    await expect(
      controller.list(authFor(fixture), undefined, undefined, "10000"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
