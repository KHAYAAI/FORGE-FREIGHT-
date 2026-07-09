"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientApi } from "@/lib/client-api";
import type { Invoice } from "@/lib/types";
import { money, fmtDate } from "@/lib/format";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { InvoiceStatusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

function PaymentRow({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((Number(invoice.totalCents) / 100).toFixed(2));
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payable = invoice.status === "ISSUED" || invoice.status === "PART_PAID" || invoice.status === "OVERDUE";

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await clientApi.recordPayment(invoice.id, {
        amountCents: Math.round(Number(amount) * 100),
        currency: invoice.currency,
        paymentRef: ref || `TXN-${Date.now()}`,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TR>
        <TD>
          <Mono className="text-primary">{invoice.number}</Mono>
        </TD>
        <TD className="text-secondary">
          {invoice.shipmentId ? <Mono>{invoice.shipmentId.slice(0, 8)}</Mono> : "—"}
        </TD>
        <TD align="right" className="tabular font-medium text-primary">
          {money(invoice.totalCents, invoice.currency)}
        </TD>
        <TD className="text-secondary">{fmtDate(invoice.dueDate)}</TD>
        <TD>
          <InvoiceStatusTag status={invoice.status} />
        </TD>
        <TD align="right">
          {payable && (
            <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
              {open ? "Cancel" : "Record payment"}
            </Button>
          )}
        </TD>
      </TR>
      {open && (
        <tr className="border-b border-hairline bg-inset">
          <td colSpan={6} className="px-5 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                  Amount ({invoice.currency})
                </span>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-8 w-32 text-[12px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                  Payment ref
                </span>
                <Input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="TXN-…"
                  className="h-8 w-40 text-[12px] font-mono"
                />
              </label>
              <Button variant="success" size="sm" onClick={pay} disabled={busy}>
                {busy ? "Recording…" : "Confirm payment"}
              </Button>
              {error && <span className="text-[11px] text-critical">{error}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function InvoicesTable({ invoices }: { invoices: Invoice[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Number</TH>
          <TH>Shipment</TH>
          <TH align="right">Amount</TH>
          <TH>Due</TH>
          <TH>Status</TH>
          <TH align="right">Action</TH>
        </TR>
      </THead>
      <tbody>
        {invoices.map((inv) => (
          <PaymentRow key={inv.id} invoice={inv} />
        ))}
      </tbody>
    </Table>
  );
}
