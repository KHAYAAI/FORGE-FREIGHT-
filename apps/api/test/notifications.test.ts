import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@forge-freight/db";
import { loadConfig } from "../src/config.js";
import { NotificationsService } from "../src/modules/notifications/notifications.service.js";
import { NotificationDispatcher } from "../src/modules/projector/notification-dispatcher.js";
import type { StoredEvent } from "../src/modules/projector/event-dispatcher.service.js";

function makeEvent(type: string, shipmentId: string | null = "ship-1"): StoredEvent {
  return {
    eventId: "evt-1",
    shipmentId,
    tenantId: "tenant-1",
    type,
    version: 1,
    occurredAt: new Date("2026-08-20T10:00:00Z"),
    recordedAt: new Date("2026-08-20T10:00:01Z"),
    payload: {},
  };
}

describe("NotificationsService", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("is disabled without NOVU_API_KEY and never calls fetch", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;
    const service = new NotificationsService(loadConfig({ AUTH_MODE: "dev", NOVU_API_KEY: "" } as NodeJS.ProcessEnv));
    expect(service.enabled).toBe(false);

    const ok = await service.trigger("shipment-milestone", { subscriberId: "p1", email: "a@b.com" }, {});
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to Novu's trigger endpoint when enabled", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    global.fetch = fetchSpy as never;
    const service = new NotificationsService(
      loadConfig({ AUTH_MODE: "dev", NOVU_API_KEY: "secret", NOVU_WORKFLOW_ID: "shipment-milestone" } as NodeJS.ProcessEnv),
    );

    const ok = await service.trigger(
      "shipment-milestone",
      { subscriberId: "party-1", email: "customer@example.com", phone: null },
      { reference: "FF-2026-00001", milestone: "Vessel departed" },
    );

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.novu.co/v1/events/trigger",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "ApiKey secret" }),
      }),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
    expect(body).toEqual({
      name: "shipment-milestone",
      to: { subscriberId: "party-1", email: "customer@example.com", phone: undefined },
      payload: { reference: "FF-2026-00001", milestone: "Vessel departed" },
    });
  });

  it("skips a subscriber with no email or phone", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;
    const service = new NotificationsService(loadConfig({ AUTH_MODE: "dev", NOVU_API_KEY: "secret" } as NodeJS.ProcessEnv));

    const ok = await service.trigger("shipment-milestone", { subscriberId: "party-1" }, {});
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns false and logs, without throwing, on a Novu-side failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") }) as never;
    const service = new NotificationsService(loadConfig({ AUTH_MODE: "dev", NOVU_API_KEY: "secret" } as NodeJS.ProcessEnv));
    const ok = await service.trigger("shipment-milestone", { subscriberId: "p1", email: "a@b.com" }, {});
    expect(ok).toBe(false);
  });

  it("returns false and logs, without throwing, on a network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as never;
    const service = new NotificationsService(loadConfig({ AUTH_MODE: "dev", NOVU_API_KEY: "secret" } as NodeJS.ProcessEnv));
    const ok = await service.trigger("shipment-milestone", { subscriberId: "p1", email: "a@b.com" }, {});
    expect(ok).toBe(false);
  });
});

describe("NotificationDispatcher", () => {
  let notifications: NotificationsService;
  let triggerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    notifications = new NotificationsService(loadConfig({ AUTH_MODE: "dev", NOVU_API_KEY: "secret" } as NodeJS.ProcessEnv));
    triggerSpy = vi.spyOn(notifications, "trigger").mockResolvedValue(true);
  });

  function makeDbStub() {
    return {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              // shipments row (reference, bookingId) on first call,
              // bookings row (customerId) on second, parties row on third —
              // the dispatcher issues three sequential lookups.
            ]),
        }),
      }),
    };
  }

  it("ignores event types that aren't customer-facing milestones", async () => {
    const db = makeDbStub();
    const dispatcher = new NotificationDispatcher(notifications);
    await dispatcher.handle(makeEvent("charge.accrued"), db as unknown as Db);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("does nothing when notifications are disabled", async () => {
    const disabled = new NotificationsService(loadConfig({ AUTH_MODE: "dev", NOVU_API_KEY: "" } as NodeJS.ProcessEnv));
    const disabledSpy = vi.spyOn(disabled, "trigger");
    const dispatcher = new NotificationDispatcher(disabled);
    await dispatcher.handle(makeEvent("vessel.departed"), {} as Db);
    expect(disabledSpy).not.toHaveBeenCalled();
  });

  it("triggers the milestone workflow for a known event with a resolvable customer", async () => {
    let call = 0;
    const rows = [
      [{ reference: "FF-2026-00001", bookingId: "booking-1" }],
      [{ customerId: "party-1" }],
      [{ id: "party-1", email: "customer@example.com", phone: null }],
    ];
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(rows[call++]),
        }),
      }),
    } as unknown as Db;

    const dispatcher = new NotificationDispatcher(notifications);
    await dispatcher.handle(makeEvent("vessel.departed"), db);

    expect(triggerSpy).toHaveBeenCalledWith(
      "shipment-milestone",
      { subscriberId: "party-1", email: "customer@example.com", phone: null },
      expect.objectContaining({ reference: "FF-2026-00001", milestone: "Vessel departed" }),
    );
  });

  it("does nothing for an event with no shipmentId", async () => {
    const dispatcher = new NotificationDispatcher(notifications);
    await dispatcher.handle(makeEvent("vessel.departed", null), {} as Db);
    expect(triggerSpy).not.toHaveBeenCalled();
  });
});
