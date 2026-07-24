import { describe, expect, it } from "vitest";
import { KNOWN_LOCODES, lookupLocode, placeLabel } from "@/lib/locode";

describe("UN/LOCODE gazetteer", () => {
  it("resolves a code regardless of case or surrounding whitespace", () => {
    // Codes arrive from user-entered quote forms as well as from the database.
    expect(lookupLocode("zadur")?.name).toBe("Durban");
    expect(lookupLocode("  ZADUR  ")?.name).toBe("Durban");
  });

  it("returns null for a code it doesn't carry", () => {
    expect(lookupLocode("XXXXX")).toBeNull();
  });

  it("falls back to the raw code when labelling an unknown place", () => {
    expect(placeLabel("ZADUR")).toBe("Durban");
    expect(placeLabel("XXXXX")).toBe("XXXXX");
  });

  it("has no duplicate codes", () => {
    const codes = KNOWN_LOCODES.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses well-formed UN/LOCODEs throughout", () => {
    for (const place of KNOWN_LOCODES) {
      expect(place.code).toMatch(/^[A-Z]{2}[A-Z0-9]{3}$/);
      expect(place.country).toBe(place.code.slice(0, 2));
    }
  });

  it("keeps every coordinate on the planet", () => {
    // A transposed lat/lon or a stray sign puts a port in the wrong ocean, and
    // the map draws it without complaint — this is the only thing that catches it.
    for (const place of KNOWN_LOCODES) {
      expect(Math.abs(place.lat), `${place.code} latitude`).toBeLessThanOrEqual(90);
      expect(Math.abs(place.lon), `${place.code} longitude`).toBeLessThanOrEqual(180);
      expect(place.lat === 0 && place.lon === 0, `${place.code} at null island`).toBe(false);
    }
  });

  it("places each port in its country's rough neighbourhood", () => {
    // Spot-checks against a handful of anchors: cheap insurance against a
    // copy-paste that leaves one port sitting on another continent.
    const anchors: Record<string, { lat: [number, number]; lon: [number, number] }> = {
      ZADUR: { lat: [-35, -22], lon: [16, 33] },
      ZAJNB: { lat: [-35, -22], lon: [16, 33] },
      CNSHA: { lat: [18, 42], lon: [105, 125] },
      NLRTM: { lat: [50, 54], lon: [3, 7] },
      BRSSZ: { lat: [-34, -1], lon: [-74, -34] },
      AUSYD: { lat: [-44, -10], lon: [113, 154] },
    };
    for (const [code, box] of Object.entries(anchors)) {
      const place = lookupLocode(code)!;
      expect(place, code).not.toBeNull();
      expect(place.lat, `${code} latitude`).toBeGreaterThanOrEqual(box.lat[0]);
      expect(place.lat, `${code} latitude`).toBeLessThanOrEqual(box.lat[1]);
      expect(place.lon, `${code} longitude`).toBeGreaterThanOrEqual(box.lon[0]);
      expect(place.lon, `${code} longitude`).toBeLessThanOrEqual(box.lon[1]);
    }
  });

  it("covers the corridors the seed data ships with", () => {
    for (const code of ["CNSHA", "DEHAM", "ZADUR", "ZAJNB"]) {
      expect(lookupLocode(code), code).not.toBeNull();
    }
  });
});
