import { describe, expect, it, vi } from "vitest";
import type { Db } from "@forge-freight/db";
import { loadConfig } from "../src/config.js";
import { ScreeningService } from "../src/modules/compliance/screening.service.js";

function makeService(results: Array<{ score: number; match?: boolean; datasets?: string[] }> | "http500") {
  const updates: unknown[] = [];
  const appendedEvents: Array<{ type: string }> = [];
  const db = {
    update: () => ({ set: (v: unknown) => ({ where: () => { updates.push(v); return Promise.resolve(); } }) }),
    insert: () => ({ values: (v: { type: string }) => { appendedEvents.push(v); return Promise.resolve(); } }),
  } as unknown as Db;
  const cfg = loadConfig({
    NODE_ENV: "test",
    AUTH_MODE: "dev",
    YENTE_URL: "http://yente.local",
  } as NodeJS.ProcessEnv);
  const service = new ScreeningService(db, cfg);
  service.fetchImpl = vi.fn(async () =>
    results === "http500"
      ? new Response("boom", { status: 500 })
      : new Response(JSON.stringify({ responses: { q: { results } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
  );
  return { service, updates, appendedEvents };
}

const party = {
  partyId: "7d5a1111-1111-1111-1111-111111111111",
  name: "Acme Trading",
  country: "ZA",
  tenantId: "994a0c36-792d-43d5-93e6-6d0078f7b295",
};

describe("ScreeningService", () => {
  it("clears parties with no matches", async () => {
    const { service, appendedEvents } = makeService([]);
    const outcome = await service.screenParty(party);
    expect(outcome.verdict).toBe("CLEAR");
    expect(appendedEvents.map((e) => e.type)).toEqual(["party.screened"]);
  });

  it("flags high-score matches as HIT and raises a compliance hold on the shipment", async () => {
    const { service, appendedEvents } = makeService([
      { score: 0.95, match: true, datasets: ["us_ofac_sdn"] },
    ]);
    const outcome = await service.screenParty({
      ...party,
      shipmentId: "8e6b2222-2222-2222-2222-222222222222",
    });
    expect(outcome.verdict).toBe("HIT");
    expect(outcome.listRefs).toEqual(["us_ofac_sdn"]);
    expect(appendedEvents.map((e) => e.type)).toEqual([
      "party.screened",
      "compliance.hold_placed",
    ]);
  });

  it("routes mid-score matches to human review", async () => {
    const { service } = makeService([{ score: 0.7, datasets: ["eu_fsf"] }]);
    const outcome = await service.screenParty(party);
    expect(outcome.verdict).toBe("REVIEW");
  });

  it("fails closed when yente is down — review, never a silent pass", async () => {
    const { service } = makeService("http500");
    const outcome = await service.screenParty(party);
    expect(outcome.verdict).toBe("REVIEW");
  });

  it("skips (dev only) when YENTE_URL is unset, emitting no events", async () => {
    const { service, appendedEvents } = makeService([]);
    (service as unknown as { cfg: { YENTE_URL: string } }).cfg.YENTE_URL = "";
    const outcome = await service.screenParty(party);
    expect(outcome.verdict).toBe("SKIPPED");
    expect(appendedEvents).toEqual([]);
  });
});
