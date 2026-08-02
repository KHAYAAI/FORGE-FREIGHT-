import { authHeaders, getSession } from "./session";
import type {
  ClassificationCandidate,
  Corridor,
  CustomsEntry,
  FinanceViews,
  FreightDocument,
  Invoice,
  NetworkOverview,
  Consignment,
  ConsignmentReference,
  MarginRule,
  Page,
  PortalTimelineEvent,
  RateCard,
  Partner,
  Party,
  PlatformFees,
  Quote,
  Shipment,
  ShipmentEvent,
  ShipmentException,
  SystemMonitor,
  Tenant,
  Charge,
} from "./types";

/**
 * Server-only typed portal API client — imports next/headers via ./session,
 * so it must not be imported from a "use client" component (that pulls the
 * whole module, session included, into the browser bundle). Client
 * components use ./client-api instead, which proxies through /api/proxy.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`${path} → ${status}: ${detail}`);
  }
}

async function headers(extra?: Record<string, string>): Promise<HeadersInit> {
  const session = await getSession();
  return { ...extra, ...authHeaders(session) };
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: await headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new ApiError(path, res.status, await res.text());
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: await headers({ "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(path, res.status, await res.text());
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: await headers({ "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(path, res.status, await res.text());
  return res.json() as Promise<T>;
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: await headers(),
    body: form,
  });
  if (!res.ok) throw new ApiError(path, res.status, await res.text());
  return res.json() as Promise<T>;
}

export * from "./types";
export { money, fmtDate, relativeTime } from "./format";

// ---------------------------------------------------------------------------
// Endpoint wrappers
// ---------------------------------------------------------------------------

export const api = {
  // Quotes / bookings
  createQuote: (body: {
    customerId: string;
    origin: string;
    destination: string;
    mode: string;
    containerType: string | null;
    quantity: number;
    incoterm: string;
  }) => apiPost<Quote>("/quotes", body),
  getQuote: (id: string) => apiGet<Quote>(`/quotes/${id}`),
  bookQuote: (id: string, carrierBookingRef?: string) =>
    apiPost<Shipment>(`/quotes/${id}/book`, carrierBookingRef ? { carrierBookingRef } : {}),

  // Shipments
  listShipments: (params: { status?: string; cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return apiGet<Page<Shipment>>(`/shipments${qs ? `?${qs}` : ""}`);
  },
  corridors: () => apiGet<Corridor[]>("/ops/corridors"),

  // Rates administration — the buy side. Read here, written from the client
  // through /api/proxy so the page can refresh in place.
  rateCards: () => apiGet<RateCard[]>("/rates/cards"),
  consignments: () => apiGet<Consignment[]>("/consignments"),
  consignmentReference: () => apiGet<ConsignmentReference>("/consignments/reference"),
  marginRules: () => apiGet<MarginRule[]>("/rates/margin-rules"),

  // Portal — the customer-facing views. Separate endpoints, not the operator
  // ones with a filter: the API scopes these by linked party, not by tenant.
  portalShipments: (params: { status?: string; cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return apiGet<Page<Shipment>>(`/portal/shipments${qs ? `?${qs}` : ""}`);
  },
  portalShipment: (id: string) => apiGet<Shipment | null>(`/portal/shipments/${id}`),
  portalTimeline: (id: string) => apiGet<PortalTimelineEvent[]>(`/portal/shipments/${id}/events`),
  portalInvoices: () => apiGet<Invoice[]>("/portal/invoices"),
  getShipment: (id: string) => apiGet<Shipment>(`/shipments/${id}`),
  shipmentTimeline: (id: string) => apiGet<ShipmentEvent[]>(`/shipments/${id}/events`),
  openExceptions: () => apiGet<ShipmentException[]>("/ops/exceptions"),

  // Parties / compliance
  listParties: () => apiGet<Party[]>("/parties"),
  getParty: (id: string) => apiGet<Party>(`/parties/${id}`),
  createParty: (body: {
    name: string;
    country?: string;
    address?: string;
    taxId?: string;
    email?: string;
    phone?: string;
  }) => apiPost<Party>("/parties", body),

  // Documents
  reviewQueue: () => apiGet<FreightDocument[]>("/documents/review-queue"),
  getDocument: (id: string) => apiGet<FreightDocument>(`/documents/${id}`),
  reviewDocument: (
    id: string,
    decision: "APPROVED" | "REJECTED",
    correctedData?: Record<string, unknown>,
  ) => apiPost<FreightDocument>(`/documents/${id}/review`, { decision, correctedData }),
  uploadDocument: (form: FormData) => apiUpload<FreightDocument>("/documents", form),

  // Customs
  classify: (q: string) =>
    apiGet<ClassificationCandidate[]>(`/customs/classify?q=${encodeURIComponent(q)}`),
  listEntries: () => apiGet<CustomsEntry[]>("/customs/entries"),
  entryByShipment: (shipmentId: string) =>
    apiGet<CustomsEntry | null>(`/customs/entries/by-shipment/${shipmentId}`),
  createEntry: (body: {
    shipmentId: string;
    lines: {
      description: string;
      customsValueCents: number;
      hsCode?: string;
      dutyRateBps?: number;
      sacuOrigin?: boolean;
    }[];
  }) => apiPost<CustomsEntry>("/customs/entries", body),
  getEntry: (id: string) => apiGet<CustomsEntry>(`/customs/entries/${id}`),
  confirmLine: (entryId: string, lineId: string, hsCode?: string) =>
    apiPost<CustomsEntry>(`/customs/entries/${entryId}/confirm-line`, { lineId, hsCode }),
  prepareEntry: (id: string) => apiPost<CustomsEntry>(`/customs/entries/${id}/prepare`),
  submitEntry: (id: string) => apiPost<CustomsEntry>(`/customs/entries/${id}/submit`),
  entryOutcome: (
    id: string,
    outcome: "QUERY" | "RELEASED" | "STOPPED",
    detail?: string,
    releaseRef?: string,
  ) => apiPost<CustomsEntry>(`/customs/entries/${id}/outcome`, { outcome, detail, releaseRef }),
  bureauPayload: (id: string) => apiGet<Record<string, unknown>>(`/customs/entries/${id}/bureau-payload`),

  // Billing
  shipmentCharges: (id: string) => apiGet<Charge[]>(`/shipments/${id}/charges`),
  issueInvoices: (shipmentId: string) => apiPost<Invoice[]>(`/shipments/${shipmentId}/invoices`),
  listInvoices: () => apiGet<Invoice[]>("/invoices"),
  recordPayment: (
    invoiceId: string,
    body: { amountCents: number; currency: string; paymentRef: string },
  ) => apiPost<Invoice>(`/invoices/${invoiceId}/payments`, body),
  financeViews: () => apiGet<FinanceViews>("/finance/views"),
  platformFees: () => apiGet<PlatformFees>("/billing/platform-fees"),

  // System
  systemMonitor: () => apiGet<SystemMonitor>("/system/monitor"),

  // Tenants (M10)
  getMyTenant: () => apiGet<Tenant | null>("/tenants/me"),
  listPartners: () => apiGet<Partner[]>("/tenants/partners"),
  createPartner: (body: { name: string; platformFeeBps: number }) =>
    apiPost<Partner>("/tenants/partners", body),
  updatePartnerFeeRate: (id: string, platformFeeBps: number) =>
    apiPatch<Partner>(`/tenants/partners/${id}/fee-rate`, { platformFeeBps }),
  getNetwork: () => apiGet<NetworkOverview>("/tenants/network"),
};
