import { describe, expect, it } from "vitest";
import {
  applyEvent,
  initialState,
  replay,
} from "../src/modules/shipments/lifecycle.js";

const e = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload });

describe("shipment lifecycle reducer", () => {
  it("happy path: booked → in transit → arrived → customs → delivery → delivered", () => {
    const state = replay([
      e("shipment.booked"),
      e("vessel.departed"),
      e("vessel.arrived"),
      e("entry.submitted"),
      e("entry.released"),
      e("container.gated_out"),
      e("pod.confirmed"),
    ]);
    expect(state.status).toBe("DELIVERED");
    expect(state.openExceptions).toEqual([]);
  });

  it("ugly path 1 — rolled booking: raises, then departure clears it", () => {
    let state = replay([e("shipment.booked"), e("booking.rolled", { reason: "vessel omitted ZADUR" })]);
    expect(state.status).toBe("BOOKED");
    expect(state.openExceptions).toEqual(["BOOKING_ROLLED"]);

    state = applyEvent(state, "vessel.departed", {});
    expect(state.status).toBe("IN_TRANSIT");
    expect(state.openExceptions).toEqual([]);
  });

  it("ugly path 2 — customs stop: raises and holds until release", () => {
    let state = replay([
      e("shipment.booked"),
      e("vessel.departed"),
      e("vessel.arrived"),
      e("entry.submitted"),
      e("entry.stopped", { reason: "documentary inspection" }),
    ]);
    expect(state.status).toBe("CUSTOMS");
    expect(state.openExceptions).toEqual(["CUSTOMS_STOP"]);

    state = applyEvent(state, "entry.released", {});
    expect(state.openExceptions).toEqual([]);
  });

  it("ugly path 3 — congestion delay from the workflow timer, cleared on departure", () => {
    let state = replay([
      e("shipment.booked"),
      e("shipment.exception_raised", { code: "CONGESTION_DELAY", detail: "no departure in 14d" }),
    ]);
    expect(state.openExceptions).toEqual(["CONGESTION_DELAY"]);

    state = applyEvent(state, "vessel.departed", {});
    expect(state.openExceptions).toEqual([]);
    expect(state.status).toBe("IN_TRANSIT");
  });

  it("does not regress status after a terminal state", () => {
    const state = replay([
      e("shipment.booked"),
      e("vessel.departed"),
      e("pod.confirmed"),
      e("vessel.arrived"), // late duplicate milestone must not un-deliver
    ]);
    expect(state.status).toBe("DELIVERED");
  });

  it("does not duplicate an already-open exception", () => {
    const state = replay([
      e("shipment.booked"),
      e("booking.rolled", {}),
      e("booking.rolled", {}),
    ]);
    expect(state.openExceptions).toEqual(["BOOKING_ROLLED"]);
  });

  it("ignores events with no lifecycle meaning", () => {
    const state = applyEvent(initialState, "road.position_reported", {});
    expect(state).toEqual(initialState);
  });
});
