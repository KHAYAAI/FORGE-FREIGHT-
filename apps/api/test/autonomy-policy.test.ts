import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutonomyPolicyService } from "../src/modules/policy/autonomy-policy.service.js";

/**
 * The loader is the enforcement point for "the operating boundaries are a
 * decision on record, not an implicit default." These tests exist to make
 * sure that claim is actually true: a missing or malformed file must refuse
 * to produce a service, exactly as an invalid environment variable refuses
 * to produce a config in config.ts.
 */
describe("AutonomyPolicyService", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "policy-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (yaml: string) => {
    const p = join(dir, "policy.yaml");
    writeFileSync(p, yaml);
    return p;
  };

  const VALID = `
shipment_sla:
  departure_days: 14
  arrival_grace_days: 7
  fallback_transit_days: 30
  customs_release_days: 10
carrier_confirmation:
  backoff_hours: [6, 12, 24]
sanctions_rescreening:
  clear_after_days: 30
  review_or_hit_after_days: 7
  max_per_run: 200
`;

  it("loads a valid file and exposes typed values", () => {
    const svc = AutonomyPolicyService.load(write(VALID));
    expect(svc.slaThresholds).toEqual({
      departureDays: 14,
      arrivalGraceDays: 7,
      fallbackTransitDays: 30,
      customsReleaseDays: 10,
    });
    expect(svc.carrierConfirmationBackoffHours).toEqual([6, 12, 24]);
    expect(svc.rescreenAfterDays).toEqual({
      UNSCREENED: 0,
      CLEAR: 30,
      REVIEW: 7,
      HIT: 7,
    });
    expect(svc.rescreenMaxPerRun).toBe(200);
  });

  it("refuses to start when the file does not exist", () => {
    expect(() => AutonomyPolicyService.load(join(dir, "missing.yaml"))).toThrow(
      /Could not read autonomy policy/,
    );
  });

  it("refuses to start on invalid YAML", () => {
    expect(() => AutonomyPolicyService.load(write("not: valid: yaml: at: all:"))).toThrow(
      /not valid YAML/,
    );
  });

  it("refuses a file missing a required section", () => {
    expect(() =>
      AutonomyPolicyService.load(write("carrier_confirmation:\n  backoff_hours: [6]\n")),
    ).toThrow(/failed validation/);
  });

  it("refuses a negative SLA threshold", () => {
    const bad = VALID.replace("departure_days: 14", "departure_days: -1");
    expect(() => AutonomyPolicyService.load(write(bad))).toThrow(/failed validation/);
  });

  it("refuses a zero-length confirmation ladder", () => {
    const bad = VALID.replace("backoff_hours: [6, 12, 24]", "backoff_hours: []");
    expect(() => AutonomyPolicyService.load(write(bad))).toThrow(/failed validation/);
  });

  it("refuses a non-numeric threshold", () => {
    const bad = VALID.replace("clear_after_days: 30", 'clear_after_days: "thirty"');
    expect(() => AutonomyPolicyService.load(write(bad))).toThrow(/failed validation/);
  });

  it("tolerates a missing paging or not_yet_enforced section — neither is read by code", () => {
    // VALID already omits both; the fact it loads at all is the assertion.
    expect(() => AutonomyPolicyService.load(write(VALID))).not.toThrow();
  });

  it("does not choke on an unvalidated typo inside not_yet_enforced", () => {
    const withTypo = VALID + "\nnot_yet_enforced:\n  carrier_booking:\n    max_vlaue_zar: 100000\n";
    expect(() => AutonomyPolicyService.load(write(withTypo))).not.toThrow();
  });

  it("loads the real config/autonomy-policy.yaml shipped in the repo", () => {
    // The single most important test here: the file a person actually edits
    // must be the file this loader actually accepts.
    const repoRoot = new URL("../../..", import.meta.url).pathname;
    const svc = AutonomyPolicyService.load(join(repoRoot, "config/autonomy-policy.yaml"));
    expect(svc.slaThresholds.departureDays).toBeGreaterThan(0);
    expect(svc.carrierConfirmationBackoffHours.length).toBeGreaterThan(0);
  });
});
