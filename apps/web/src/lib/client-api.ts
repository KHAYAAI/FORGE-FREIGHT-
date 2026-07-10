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
};
