/**
 * Shipment lifecycle state machine — a pure reducer over catalogue events.
 * The event projector uses it to maintain the shipments/exceptions
 * projections; the Temporal workflow uses the same transitions for its
 * in-workflow state. One source of truth for "what does this event mean".
 */

export type ShipmentStatus =
  | "BOOKED"
  | "IN_TRANSIT"
  | "AT_DESTINATION_PORT"
  | "CUSTOMS"
  | "ON_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export type ExceptionCode =
  | "BOOKING_ROLLED"
  | "CUSTOMS_STOP"
  | "CUSTOMS_QUERY"
  | "CONGESTION_DELAY"
  | "COMPLIANCE_HOLD";

export interface LifecycleState {
  status: ShipmentStatus;
  openExceptions: ExceptionCode[];
}

export interface LifecycleEffect {
  status?: ShipmentStatus;
  raise?: { code: ExceptionCode; detail: string | null };
  clear?: ExceptionCode[];
}

export const initialState: LifecycleState = {
  status: "BOOKED",
  openExceptions: [],
};

/**
 * What a single event does to a shipment. Returns null for events with no
 * lifecycle meaning (positions, documents, billing...).
 */
export function effectOf(
  eventType: string,
  payload: Record<string, unknown>,
): LifecycleEffect | null {
  switch (eventType) {
    case "shipment.booked":
      return { status: "BOOKED" };
    case "booking.rolled":
      return {
        raise: {
          code: "BOOKING_ROLLED",
          detail: typeof payload.reason === "string" ? payload.reason : null,
        },
      };
    case "vessel.departed":
      // Departure resolves a roll and any pre-departure congestion flag.
      return { status: "IN_TRANSIT", clear: ["BOOKING_ROLLED", "CONGESTION_DELAY"] };
    case "vessel.arrived":
    case "container.discharged":
      return { status: "AT_DESTINATION_PORT" };
    case "entry.submitted":
      return { status: "CUSTOMS" };
    case "entry.queried":
      return {
        raise: {
          code: "CUSTOMS_QUERY",
          detail: typeof payload.queryText === "string" ? payload.queryText : null,
        },
      };
    case "entry.stopped":
      return {
        raise: {
          code: "CUSTOMS_STOP",
          detail: typeof payload.reason === "string" ? payload.reason : null,
        },
      };
    case "entry.released":
      return { clear: ["CUSTOMS_STOP", "CUSTOMS_QUERY"] };
    case "container.gated_out":
      return { status: "ON_DELIVERY" };
    case "pod.confirmed":
      return { status: "DELIVERED", clear: ["CONGESTION_DELAY"] };
    case "compliance.hold_placed":
      return {
        raise: {
          code: "COMPLIANCE_HOLD",
          detail: typeof payload.reason === "string" ? payload.reason : null,
        },
      };
    case "shipment.exception_raised": {
      const code = payload.code as ExceptionCode;
      return {
        raise: { code, detail: typeof payload.detail === "string" ? payload.detail : null },
      };
    }
    case "shipment.exception_cleared":
      return { clear: [payload.code as ExceptionCode] };
    default:
      return null;
  }
}

const TERMINAL: ShipmentStatus[] = ["DELIVERED", "CANCELLED"];

export function applyEvent(
  state: LifecycleState,
  eventType: string,
  payload: Record<string, unknown>,
): LifecycleState {
  const effect = effectOf(eventType, payload);
  if (!effect) return state;

  let status = state.status;
  if (effect.status && !TERMINAL.includes(state.status)) {
    status = effect.status;
  }

  let openExceptions = state.openExceptions;
  if (effect.clear) {
    openExceptions = openExceptions.filter((c) => !effect.clear!.includes(c));
  }
  if (effect.raise && !openExceptions.includes(effect.raise.code)) {
    openExceptions = [...openExceptions, effect.raise.code];
  }

  return { status, openExceptions };
}

export function replay(
  events: Array<{ type: string; payload: Record<string, unknown> }>,
): LifecycleState {
  return events.reduce(
    (state, e) => applyEvent(state, e.type, e.payload),
    initialState,
  );
}
