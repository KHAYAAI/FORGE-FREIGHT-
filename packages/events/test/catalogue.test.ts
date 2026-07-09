import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  catalogue,
  ChargeAccrued,
  EntryReleased,
  getEventDefinition,
  makeEvent,
  parseEvent,
  UnknownEventError,
  VesselDeparted,
} from "../src/index.js";

const actor = { kind: "SYSTEM" as const, id: "test" };
const tenantId = randomUUID();

describe("event catalogue", () => {
  it("has unique type@version keys", () => {
    const keys = catalogue.map((d) => `${d.type}@${d.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves definitions from the registry", () => {
    expect(getEventDefinition("vessel.departed", 1)).toBe(VesselDeparted);
    expect(getEventDefinition("vessel.departed", 99)).toBeUndefined();
  });

  it("flags exactly the financially-meaningful events for the ontology bridge", () => {
    const financial = catalogue.filter((d) => d.financial).map((d) => d.type);
    expect(financial.sort()).toEqual(
      [
        "charge.accrued",
        "entry.released",
        "invoice.issued",
        "payment.received",
        "pod.confirmed",
        "shipment.booked",
        "vessel.departed",
      ].sort(),
    );
  });
});

describe("makeEvent / parseEvent", () => {
  it("builds and round-trips a valid envelope", () => {
    const event = makeEvent({
      definition: VesselDeparted,
      tenantId,
      actor,
      shipmentId: randomUUID(),
      payload: {
        vesselImo: "9321483",
        vesselName: "MSC SINFONIA",
        port: "CNSHA",
        source: "AIS",
        etaDestination: null,
      },
    });
    const parsed = parseEvent(JSON.parse(JSON.stringify(event)));
    expect(parsed.type).toBe("vessel.departed");
    expect(parsed.version).toBe(1);
  });

  it("rejects payloads that violate the schema", () => {
    expect(() =>
      makeEvent({
        definition: VesselDeparted,
        tenantId,
        actor,
        payload: {
          vesselImo: "not-an-imo",
          vesselName: null,
          port: "CNSHA",
          source: "AIS",
          etaDestination: null,
        },
      }),
    ).toThrow();
  });

  it("rejects unknown event types on parse", () => {
    const event = makeEvent({
      definition: ChargeAccrued,
      tenantId,
      actor,
      payload: {
        chargeId: randomUUID(),
        chargeCode: "OFR",
        description: "Ocean freight",
        kind: "FREIGHT",
        buy: { amountCents: 150000_00, currency: "USD" },
        sell: { amountCents: 185000_00, currency: "USD" },
        triggeredBy: "vessel.departed",
      },
    });
    const tampered = { ...event, type: "nonexistent.event" };
    expect(() => parseEvent(tampered)).toThrow(UnknownEventError);
  });

  it("enforces integer cents on money", () => {
    expect(() =>
      makeEvent({
        definition: EntryReleased,
        tenantId,
        actor,
        payload: {
          customsEntryId: randomUUID(),
          dutiesTotal: { amountCents: 1234.56, currency: "ZAR" },
          vatTotal: { amountCents: 100, currency: "ZAR" },
          releaseRef: null,
        },
      }),
    ).toThrow();
  });
});
