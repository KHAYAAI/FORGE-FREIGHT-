import { describe, expect, it } from "vitest";
import { DcsaAdapter } from "../src/modules/ingest/dcsa.adapter.js";
import { EdifactIftstaAdapter } from "../src/modules/ingest/edifact.adapter.js";
import { extractIftsta, parseSegments } from "../src/modules/ingest/edifact.js";
import { TraccarAdapter } from "../src/modules/ingest/traccar.adapter.js";

describe("DCSA adapter", () => {
  const dcsa = new DcsaAdapter();

  it("maps an ACT DEPA transport event to vessel.departed with booking match", () => {
    const [emission] = dcsa.parse({
      eventID: "evt-1",
      eventType: "TRANSPORT",
      eventClassifierCode: "ACT",
      transportEventTypeCode: "DEPA",
      eventDateTime: "2026-07-20T10:00:00Z",
      transportCall: {
        UNLocationCode: "CNSHA",
        vessel: { vesselIMONumber: "9321483", name: "MSC SINFONIA" },
      },
      documentReferences: [{ type: "BKG", value: "MAEU12345678" }],
    });
    expect(emission!.definition.type).toBe("vessel.departed");
    expect(emission!.sourceRef).toBe("dcsa:evt-1");
    expect(emission!.match).toEqual({
      by: "carrierBookingRef",
      carrierBookingRef: "MAEU12345678",
    });
  });

  it("ignores estimated events — projections never contain estimates", () => {
    const emissions = dcsa.parse({
      eventID: "evt-2",
      eventType: "TRANSPORT",
      eventClassifierCode: "EST",
      transportEventTypeCode: "ARRI",
      eventDateTime: "2026-08-15T00:00:00Z",
      transportCall: { UNLocationCode: "ZADUR", vessel: { vesselIMONumber: "9321483" } },
    });
    expect(emissions).toEqual([]);
  });

  it("maps equipment events to container milestones matched by container number", () => {
    const [emission] = dcsa.parse({
      eventID: "evt-3",
      eventType: "EQUIPMENT",
      eventClassifierCode: "ACT",
      equipmentEventTypeCode: "DISC",
      equipmentReference: "MSKU1234565",
      eventDateTime: "2026-08-16T08:00:00Z",
      eventLocation: { UNLocationCode: "ZADUR" },
    });
    expect(emission!.definition.type).toBe("container.discharged");
    expect(emission!.match).toEqual({
      by: "containerNumber",
      containerNumber: "MSKU1234565",
    });
  });
});

describe("Traccar adapter", () => {
  it("converts a position webhook to road.position_reported (knots→kph)", () => {
    const [emission] = new TraccarAdapter().parse({
      position: {
        id: 991,
        latitude: -29.8587,
        longitude: 31.0218,
        speed: 40, // knots
        fixTime: "2026-08-20T06:30:00Z",
      },
      device: { uniqueId: "truck-042" },
    });
    expect(emission!.definition.type).toBe("road.position_reported");
    expect(emission!.match).toEqual({ by: "traccarDevice", deviceId: "truck-042" });
    expect((emission!.payload as { speedKph: number }).speedKph).toBeCloseTo(74.1);
    expect(emission!.sourceRef).toBe("traccar:991");
  });
});

describe("EDIFACT parser", () => {
  it("parses segments with release characters", () => {
    const segments = parseSegments("BGM+23+DOC?+1'FTX+AAA+++Free ?'text?' here'");
    expect(segments[0]).toEqual({ tag: "BGM", elements: [["23"], ["DOC+1"]] });
    expect(segments[1]!.elements[3]).toEqual(["Free 'text' here"]);
  });

  it("extracts IFTSTA consignment statuses", () => {
    const raw = [
      "UNH+MSG001+IFTSTA:D:01B:UN'",
      "CNI+1+MAEU12345678'",
      "EQD+CN+MSKU1234565'",
      "STS+1+DEP'",
      "DTM+334:202607201000:203'",
      "LOC+9+CNSHA'",
      "UNT+7+MSG001'",
    ].join("\n");
    const [status] = extractIftsta(raw);
    expect(status).toEqual({
      messageRef: "MSG001",
      consignmentRef: "MAEU12345678",
      containerNumber: "MSKU1234565",
      statusCode: "DEP",
      occurredAt: new Date(Date.UTC(2026, 6, 20, 10, 0)),
      location: "CNSHA",
    });
  });
});

describe("EDIFACT IFTSTA adapter", () => {
  const adapter = new EdifactIftstaAdapter("example", {
    DEP: "vessel.departed",
    GOUT: "container.gated_out",
  });

  it("maps configured status codes and skips unmapped ones", () => {
    const raw = [
      "UNH+MSG002+IFTSTA:D:01B:UN'",
      "CNI+1+MAEU12345678'",
      "EQD+CN+MSKU1234565'",
      "STS+1+DEP'",
      "DTM+334:20260720:102'",
      "STS+1+XYZ'", // not in the partner map — ignored, never guessed
      "UNT+7+MSG002'",
    ].join("");
    const emissions = adapter.parse(raw);
    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.definition.type).toBe("vessel.departed");
    expect(emissions[0]!.sourceRef).toBe("edifact:example:MSG002:0");
  });
});
