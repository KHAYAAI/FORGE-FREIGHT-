"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/client-api";
import type { BillingProfile } from "@/lib/types";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * The company's own invoice identity.
 *
 * This form is what makes the platform multi-company rather than one
 * forwarder's billing system. Everything on it appears on the document a
 * customer pays from: the registration they check, the VAT number they reclaim
 * against, the customs client number their broker reconciles the entry with,
 * the account the money goes into, and the numbering series their AP system
 * files it under.
 *
 * Saved in pieces on purpose. Onboarding a forwarder takes days — the VAT
 * number arrives before the bank confirmation letter does — and a form that
 * refuses a partial save is a form people fill with placeholder text. What is
 * still missing is reported, on the invoice itself as well as here.
 */
export function BillingProfileForm({ profile }: { profile: BillingProfile }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(profile);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof BillingProfile>(key: K, value: BillingProfile[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const text = (key: keyof BillingProfile) => ({
    value: (form[key] as string | null) ?? "",
    onChange: (e: { target: { value: string } }) =>
      set(key, (e.target.value || null) as BillingProfile[typeof key]),
  });

  async function save() {
    setBusy(true);
    try {
      const updated = await clientApi.updateBillingProfile({
        legalName: form.legalName,
        tradingName: form.tradingName,
        registrationNumber: form.registrationNumber,
        vatNumber: form.vatNumber,
        customsClientNumber: form.customsClientNumber,
        addressLines: form.addressLines,
        country: form.country,
        email: form.email,
        phone: form.phone,
        bankName: form.bankName,
        bankAccountName: form.bankAccountName,
        bankAccountNumber: form.bankAccountNumber,
        bankBranchCode: form.bankBranchCode,
        bankSwift: form.bankSwift,
        invoiceNumberPrefix: form.invoiceNumberPrefix,
        defaultPaymentTermsDays: Number(form.defaultPaymentTermsDays),
        defaultCurrency: form.defaultCurrency,
        vatBps: Number(form.vatBps),
        invoiceFooter: form.invoiceFooter,
      });
      setForm(updated);
      toast.success(
        "Billing profile saved",
        updated.completeness.ready
          ? "Invoices issued from now on carry these details."
          : `Still missing: ${updated.completeness.missing.join("; ")}.`,
      );
      router.refresh();
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!profile.completeness.ready && (
        <div className="rounded border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-warning-wash px-4 py-3">
          <div className="text-[12px] font-semibold text-warning">
            Invoices issued now will be incomplete
          </div>
          <ul className="mt-1 list-disc pl-5 text-[11.5px] text-warning">
            {profile.completeness.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <Panel>
        <PanelHeader eyebrow="Who is billing" title="Company" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registered legal name" required>
            <Input
              value={form.legalName}
              onChange={(e) => set("legalName", e.target.value)}
            />
          </Field>
          <Field label="Trading name" hint="Printed as the masthead if set.">
            <Input {...text("tradingName")} />
          </Field>
          <Field label="Company registration number">
            <Input {...text("registrationNumber")} placeholder="2019/447281/07" />
          </Field>
          <Field
            label="VAT registration number"
            hint="Without it, invoices are issued without VAT and the audit stops checking VAT treatment."
          >
            <Input {...text("vatNumber")} placeholder="4820291837" />
          </Field>
          <Field
            label="Customs client number"
            hint="The SARS CCN this company trades under. Required to lodge declarations, and printed so the customer's broker can reconcile the entry."
          >
            <Input {...text("customsClientNumber")} placeholder="20418877" />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={(e) => set("country", e.target.value)} maxLength={2} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Registered address">
              <Textarea rows={3} {...text("addressLines")} />
            </Field>
          </div>
          <Field label="Billing email">
            <Input {...text("email")} />
          </Field>
          <Field label="Phone">
            <Input {...text("phone")} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader eyebrow="Where the money goes" title="Bank details" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank">
            <Input {...text("bankName")} />
          </Field>
          <Field label="Account name">
            <Input {...text("bankAccountName")} />
          </Field>
          <Field label="Account number">
            <Input {...text("bankAccountNumber")} />
          </Field>
          <Field label="Branch code">
            <Input {...text("bankBranchCode")} />
          </Field>
          <Field label="SWIFT / BIC" hint="Needed for any customer paying from outside the country.">
            <Input {...text("bankSwift")} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader eyebrow="How invoices are issued" title="Numbering and terms" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Number prefix"
            hint={`Next: ${form.invoiceNumberPrefix}-${new Date().getUTCFullYear()}-${String(form.nextInvoiceNumber).padStart(6, "0")}`}
          >
            <Input
              value={form.invoiceNumberPrefix}
              onChange={(e) => set("invoiceNumberPrefix", e.target.value.toUpperCase())}
              maxLength={8}
            />
          </Field>
          <Field label="Default payment terms (days)">
            <Input
              type="number"
              value={form.defaultPaymentTermsDays}
              onChange={(e) => set("defaultPaymentTermsDays", Number(e.target.value))}
            />
          </Field>
          <Field label="Default currency">
            <Input
              value={form.defaultCurrency}
              onChange={(e) => set("defaultCurrency", e.target.value.toUpperCase())}
              maxLength={3}
            />
          </Field>
          <Field
            label="VAT rate (%)"
            hint="Applied to taxable lines. Duties and import VAT recovered at cost stay zero-rated regardless."
          >
            <Input
              type="number"
              step="0.01"
              value={form.vatBps / 100}
              onChange={(e) => set("vatBps", Math.round(Number(e.target.value) * 100))}
            />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Invoice footer" hint="Printed under the totals on every invoice.">
              <Textarea rows={2} {...text("invoiceFooter")} />
            </Field>
          </div>
        </div>
      </Panel>

      <div>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save billing profile"}
        </Button>
      </div>
    </div>
  );
}
