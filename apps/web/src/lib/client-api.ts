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
  MarginRule,
  RateCard,
  RateSurcharge,
  Shipment,
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
  }) => post<Quote & { quoteId: string; result: { carrierName: string; transitDays: number | null; lines: { chargeCode: string; description: string; quantity: number; sellCents: number; currency: string }[]; totalsByCurrency: Record<string, number> } }>("/quotes", body),
  bookQuote: (id: string, carrierBookingRef?: string) =>
    post<Shipment & { reference: string }>(`/quotes/${id}/book`, carrierBookingRef ? { carrierBookingRef } : {}),
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
    post<Invoice>(`/invoices/${invoiceId}/payments`, body),
  financeViews: () => get<FinanceViews>("/finance/views"),

  createPartner: (body: { name: string; platformFeeBps: number }) =>
    post<Partner>("/tenants/partners", body),
  updatePartnerFeeRate: (id: string, platformFeeBps: number) =>
    patch<Partner>(`/tenants/partners/${id}/fee-rate`, { platformFeeBps }),

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
