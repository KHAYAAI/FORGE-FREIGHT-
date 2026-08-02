"use client";

import type {
  ClassificationCandidate,
  CustomsEntry,
  FinanceViews,
  FreightDocument,
  Invoice,
  Partner,
  Party,
  Quote,
  Consignment,
  ConsignmentReference,
  MarginRule,
  Measurement,
  Payment,
  PaymentResult,
  RateCard,
  RateSurcharge,
  AuditResult,
  BillingProfile,
  DisputePacket,
  ExceptionRow,
  ExceptionStatus,
} from "./types";

/** Client-side counterpart to lib/api.ts — goes through /api/proxy (same-origin, no CORS). */

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

/** DELETE answers 204 with no body, so there is nothing to parse. */
async function del(path: string): Promise<void> {
  const res = await fetch(`/api/proxy${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const clientApi = {
  createQuote: (body: {
    customerId: string;
    origin: string;
    destination: string;
    mode: string;
    containerType: string | null;
    quantity: number;
    incoterm: string;
    consignment?: ConsignmentDraft;
  }) => post<Quote & { quoteId: string; result: { carrierName: string; transitDays: number | null; lines: { chargeCode: string; description: string; quantity: number; sellCents: number; currency: string }[]; totalsByCurrency: Record<string, number> } }>("/quotes", body),
  /** The API answers with ids, not a shipment row — see `BookQuoteResult`. */
  bookQuote: (id: string, carrierBookingRef?: string) =>
    post<{ bookingId: string; shipmentId: string; reference: string }>(
      `/quotes/${id}/book`,
      carrierBookingRef ? { carrierBookingRef } : {},
    ),
  listParties: () => get<Party[]>("/parties"),
  createParty: (body: {
    name: string;
    country?: string;
    address?: string;
    taxId?: string;
    email?: string;
    phone?: string;
  }) => post<Party>("/parties", body),

  reviewDocument: (id: string, decision: "APPROVED" | "REJECTED", correctedData?: Record<string, unknown>) =>
    post<FreightDocument>(`/documents/${id}/review`, { decision, correctedData }),
  uploadDocument: (form: FormData) => upload<FreightDocument>("/documents", form),

  classify: (q: string) => get<ClassificationCandidate[]>(`/customs/classify?q=${encodeURIComponent(q)}`),
  createEntry: (body: {
    shipmentId: string;
    lines: {
      description: string;
      customsValueCents: number;
      hsCode?: string;
      dutyRateBps?: number;
      sacuOrigin?: boolean;
    }[];
  }) => post<CustomsEntry>("/customs/entries", body),
  confirmLine: (entryId: string, lineId: string, hsCode?: string) =>
    post<CustomsEntry>(`/customs/entries/${entryId}/confirm-line`, { lineId, hsCode }),
  prepareEntry: (id: string) => post<CustomsEntry>(`/customs/entries/${id}/prepare`),
  submitEntry: (id: string) => post<CustomsEntry>(`/customs/entries/${id}/submit`),
  entryOutcome: (id: string, outcome: "QUERY" | "RELEASED" | "STOPPED", detail?: string, releaseRef?: string) =>
    post<CustomsEntry>(`/customs/entries/${id}/outcome`, { outcome, detail, releaseRef }),

  issueInvoices: (shipmentId: string) => post<Invoice[]>(`/shipments/${shipmentId}/invoices`),
  recordPayment: (invoiceId: string, body: { amountCents: number; currency: string; paymentRef: string }) =>
    post<PaymentResult>(`/invoices/${invoiceId}/payments`, body),
  listPayments: (invoiceId: string) => get<Payment[]>(`/invoices/${invoiceId}/payments`),
  financeViews: () => get<FinanceViews>("/finance/views"),

  // The four-way match. A POST because the findings are persisted and a human
  // then acts on their status.
  auditInvoice: (invoiceId: string) => post<AuditResult>(`/invoices/${invoiceId}/audit`),
  invoiceExceptions: (invoiceId: string) => get<ExceptionRow[]>(`/invoices/${invoiceId}/exceptions`),
  resolveException: (id: string, status: ExceptionStatus, note?: string) =>
    patch<ExceptionRow["exception"]>(`/billing/exceptions/${id}`, { status, note: note ?? null }),
  disputePacket: (invoiceId: string) => get<DisputePacket>(`/invoices/${invoiceId}/dispute-packet`),

  updateBillingProfile: (body: Record<string, unknown>) =>
    patch<BillingProfile>("/billing/profile", body),

  createPartner: (body: { name: string; platformFeeBps: number }) =>
    post<Partner>("/tenants/partners", body),
  updatePartnerFeeRate: (id: string, platformFeeBps: number) =>
    patch<Partner>(`/tenants/partners/${id}/fee-rate`, { platformFeeBps }),

  consignmentReference: () => get<ConsignmentReference>("/consignments/reference"),
  /** Price a packing list without saving it — drives the live totals in the form. */
  measureConsignment: (body: ConsignmentDraft & { mode: string }) =>
    post<Measurement>("/consignments/measure", body),
  listConsignments: () => get<Consignment[]>("/consignments"),

  listRateCards: () => get<RateCard[]>("/rates/cards"),
  createRateCard: (body: RateCardDraft) => post<RateCard>("/rates/cards", body),
  updateRateCard: (id: string, body: Partial<RateCardDraft>) =>
    patch<RateCard>(`/rates/cards/${id}`, body),
  replaceSurcharges: (id: string, surcharges: SurchargeDraft[]) =>
    put<RateSurcharge[]>(`/rates/cards/${id}/surcharges`, { surcharges }),
  deleteRateCard: (id: string) => del(`/rates/cards/${id}`),

  listMarginRules: () => get<MarginRule[]>("/rates/margin-rules"),
  createMarginRule: (body: MarginRuleDraft) => post<MarginRule>("/rates/margin-rules", body),
  updateMarginRule: (id: string, body: Partial<MarginRuleDraft>) =>
    patch<MarginRule>(`/rates/margin-rules/${id}`, body),
  deleteMarginRule: (id: string) => del(`/rates/margin-rules/${id}`),
};

export interface CargoItemDraft {
  description: string;
  packageType: string;
  pieces: number;
  /** Gross weight of the line, in grams. The form collects kilograms. */
  grossWeightGrams: number;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  stackable: boolean;
  marksAndNumbers?: string | null;
  hsCode?: string | null;
}

export interface ConsignmentDraft {
  description: string;
  cargoType: string;
  urgency: string;
  pickupLocode?: string | null;
  pickupAddress?: string | null;
  pickupContact?: string | null;
  pickupFrom?: string | null;
  pickupTo?: string | null;
  portOfExit: string;
  portOfEntry: string;
  unNumber?: string | null;
  imoClass?: string | null;
  packingGroup?: string | null;
  tempMinDeciC?: number | null;
  tempMaxDeciC?: number | null;
  items: CargoItemDraft[];
}

export interface SurchargeDraft {
  code: string;
  description: string;
  basis: RateSurcharge["basis"];
  amountCents: number;
  currency: string;
}

export interface RateCardDraft {
  kind: "CONTRACT" | "SPOT";
  carrierName: string;
  mode: RateCard["mode"];
  origin: string;
  destination: string;
  containerType: RateCard["containerType"];
  buyAmountCents: number;
  currency: string;
  transitDays: number | null;
  validFrom: string;
  validTo: string;
  surcharges?: SurchargeDraft[];
}

export interface MarginRuleDraft {
  customerId: string | null;
  origin: string | null;
  destination: string | null;
  mode: RateCard["mode"] | null;
  marginBps: number;
  minMarginCents: number;
}
