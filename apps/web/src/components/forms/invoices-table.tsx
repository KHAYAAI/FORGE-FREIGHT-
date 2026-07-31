"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientApi } from "@/lib/client-api";
import type { Invoice, Payment } from "@/lib/types";
import { money, fmtDate } from "@/lib/format";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { InvoiceStatusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

function PaymentRow({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const outstanding = invoice.outstandingCents ?? invoice.totalCents;
  // Default to what is actually still owed, not the whole invoice — on a
  // part-paid invoice the full total is the one number that is certainly wrong.
  const [amount, setAmount] = useState((Math.max(outstanding, 0) / 100).toFixed(2));
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Payment[] | null>(null);

  const payable =
    invoice.status === "ISSUED" || invoice.status === "PART_PAID" || invoice.status === "OVERDUE";

  async function pay() {
    // The reference is what makes a redelivered payment a no-op rather than a
    // second credit. This form used to invent one from the clock when it was
    // left blank, which meant every retry looked like new money.
    if (!ref.trim()) {
      setError("A payment reference is required — it is what prevents double-crediting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await clientApi.recordPayment(invoice.id, {
        amountCents: Math.round(Number(amount) * 100),
        currency: invoice.currency,
        paymentRef: ref.trim(),
      });
      if (result.duplicate) {
        toast.info(
          "Already recorded",
          `Reference ${ref.trim()} was already applied to ${invoice.number}; nothing changed.`,
        );
      } else if (result.overpaidCents > 0) {
        toast.success(
          "Payment recorded — overpaid",
          `${invoice.number} is settled, with ${money(result.overpaidCents, invoice.currency)} to refund.`,
        );
      } else {
        toast.success(
          "Payment recorded",
          `${invoice.number}: ${money(result.outstandingCents, invoice.currency)} still outstanding.`,
        );
      }
      setOpen(false);
      setRef("");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error("Could not record payment", message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory() {
    if (history) return setHistory(null);
    try {
      setHistory(await clientApi.listPayments(invoice.id));
    } catch (err) {
      toast.error("Could not load payments", err instanceof Error ? err.message : String(err));
    }
  }

  const paid = invoice.paidCents ?? 0;

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
        <TD align="right" className="tabular text-secondary">
          {paid === 0 ? (
            "—"
          ) : (
            <button
              type="button"
              onClick={toggleHistory}
              className="text-accent hover:underline"
              title="Show the payments behind this figure"
            >
              {money(paid, invoice.currency)}
            </button>
          )}
        </TD>
        <TD align="right" className="tabular">
          <span className={outstanding > 0 ? "text-primary" : "text-tertiary"}>
            {money(Math.max(outstanding, 0), invoice.currency)}
          </span>
          {outstanding < 0 && (
            <span className="ml-1.5 text-[11px] text-warning">
              {money(-outstanding, invoice.currency)} over
            </span>
          )}
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

      {history && (
        <tr className="border-b border-hairline bg-inset">
          <td colSpan={8} className="px-5 py-3">
            <div className="flex flex-col gap-1">
              {history.length === 0 && (
                <span className="text-[11.5px] text-tertiary">No payments recorded.</span>
              )}
              {history.map((p) => (
                <span key={p.id} className="text-[11.5px] text-secondary">
                  <Mono className="text-primary">{p.paymentRef}</Mono>{" "}
                  <span className="tabular">{money(p.amountCents, p.currency)}</span>{" "}
                  <span className="text-tertiary">received {fmtDate(p.receivedAt)}</span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}

      {open && (
        <tr className="border-b border-hairline bg-inset">
          <td colSpan={8} className="px-5 py-3">
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
                  Payment ref <span className="text-critical">*</span>
                </span>
                <Input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="Bank reference"
                  className="h-8 w-48 text-[12px] font-mono"
                  required
                />
              </label>
              <Button variant="success" size="sm" onClick={pay} disabled={busy}>
                {busy ? "Recording…" : "Confirm payment"}
              </Button>
              {error && <span className="text-[11px] text-critical">{error}</span>}
            </div>
            <p className="mt-2 text-[11px] text-tertiary">
              The reference is the bank&apos;s, not ours. Recording the same one twice against this
              invoice changes nothing — that is what stops a redelivered payment crediting the
              customer twice.
            </p>
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
          <TH align="right">Paid</TH>
          <TH align="right">Outstanding</TH>
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
