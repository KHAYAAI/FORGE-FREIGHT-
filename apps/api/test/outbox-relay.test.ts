import { describe, expect, it } from "vitest";
import type { Db } from "@forge-freight/db";
import { loadConfig } from "../src/config.js";
import {
  OutboxRelayService,
  type OutboxRow,
} from "../src/modules/outbox/outbox-relay.service.js";

function makeRow(id: string): OutboxRow {
  return {
    eventId: id,
    shipmentId: null,
    tenantId: "t1",
    type: "quote.issued",
    version: 1,
    occurredAt: new Date(),
    recordedAt: new Date(),
    actor: { kind: "SYSTEM", id: "test" },
    sourceRef: null,
    payload: {},
  };
}

/** Minimal stub of the two Drizzle call chains tick() uses. */
function makeDbStub(rows: OutboxRow[]) {
  const marked: string[][] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: (cond: { queryChunks?: unknown }) => {
          marked.push(rows.map((r) => r.eventId));
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as Db;
  return { db, marked };
}

const cfg = loadConfig({
  NODE_ENV: "test",
  AUTH_MODE: "dev",
  KAFKA_TOPIC_EVENTS: "freight.events",
  OUTBOX_BATCH_SIZE: "50",
} as NodeJS.ProcessEnv);

describe("OutboxRelayService.tick", () => {
  it("publishes unpublished rows then marks them published", async () => {
    const rows = [makeRow("e1"), makeRow("e2")];
    const { db, marked } = makeDbStub(rows);
    const relay = new OutboxRelayService(db, cfg);

    const published: Array<{ topic: string; count: number }> = [];
    const n = await relay.tick({
      publish: async (topic, batch) => {
        published.push({ topic, count: batch.length });
      },
    });

    expect(n).toBe(2);
    expect(published).toEqual([{ topic: "freight.events", count: 2 }]);
    expect(marked).toHaveLength(1); // marked exactly once, after publish
  });

  it("does nothing when the outbox is empty", async () => {
    const { db, marked } = makeDbStub([]);
    const relay = new OutboxRelayService(db, cfg);
    const n = await relay.tick({
      publish: async () => {
        throw new Error("must not publish an empty batch");
      },
    });
    expect(n).toBe(0);
    expect(marked).toHaveLength(0);
  });

  it("does not mark rows published when the broker publish fails", async () => {
    const rows = [makeRow("e1")];
    const { db, marked } = makeDbStub(rows);
    const relay = new OutboxRelayService(db, cfg);
    await expect(
      relay.tick({
        publish: async () => {
          throw new Error("broker down");
        },
      }),
    ).rejects.toThrow("broker down");
    expect(marked).toHaveLength(0); // rows stay queued for the next tick
  });
});
