import { Tag, type Tone } from "@/components/ui/badge";
import { cbm, fmtDay, kg, money } from "@/lib/format";
import type { ChargeProvenance, InvoiceDocument } from "@/lib/types";

/**
 * The invoice, as a document.
 *
 * Not a table of charges — a billing document a customer's accounts-payable
 * team can act on without picking up the phone. That means it carries, on its
 * face, every reference an AP clerk matches on (their PO, the bill of lading,
 * the shipment reference, the container numbers), the issuing company's tax
 * and customs registrations, the bank account to pay into, and the charges
 * grouped the way the trade reads them rather than the order they accrued.
 *
 * `commercial` is the operator/customer switch. It adds the cost and margin
 * columns, which are the forwarder's own information — though by then the API
 * has already withheld the buy prices, so this only decides whether to render
 * columns that would otherwise be empty.
 */

const PROVENANCE_LABEL: Record<ChargeProvenance, string> = {
  PASS_THROUGH: "At cost",
  MARKED_UP: "Third party",
  FORWARDER_ORIGINATED: "Our service",
};

const PROVENANCE_TONE: Record<ChargeProvenance, Tone> = {
  PASS_THROUGH: "neutral",
  MARKED_UP: "info",
  FORWARDER_ORIGINATED: "accent",
};

const BASIS_LABEL: Record<string, string> = {
  PER_SHIPMENT: "shipment",
  PER_CONTAINER: "container",
  PER_KG: "kg",
  PER_CBM: "m³",
  PER_DOCUMENT: "document",
  PER_DAY: "day",
  PERCENTAGE: "%",
};

const STATUS_TONE: Record<string, Tone> = {
  ISSUED: "info",
  PART_PAID: "warning",
  PAID: "success",
  OVERDUE: "critical",
  CANCELLED: "neutral",
};

export function InvoiceDocumentView({
  doc,
  commercial = false,
}: {
  doc: InvoiceDocument;
  commercial?: boolean;
}) {
  const c = doc.currency;

  return (
    <article className="rounded border border-hairline bg-surface p-6 sm:p-8">
      {/* Masthead ---------------------------------------------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-hairline pb-5">
        <div>
          <div className="text-[17px] font-semibold text-primary">
            {doc.issuer.tradingName || doc.issuer.legalName}
          </div>
          {doc.issuer.tradingName && (
            <div className="text-[11px] text-tertiary">{doc.issuer.legalName}</div>
          )}
          <div className="mt-2 whitespace-pre-line text-[11.5px] leading-relaxed text-secondary">
            {doc.issuer.addressLines || "—"}
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-tertiary">
            {doc.issuer.registrationNumber && <Reg label="Reg" value={doc.issuer.registrationNumber} />}
            {doc.issuer.vatNumber && <Reg label="VAT" value={doc.issuer.vatNumber} />}
            {/* The customs client number belongs on the face of the document:
                the customer's own broker reconciles the entry against it. */}
            {doc.issuer.customsClientNumber && (
              <Reg label="Customs client" value={doc.issuer.customsClientNumber} />
            )}
          </dl>
        </div>

        <div className="text-right">
          <div className="text-[10.5px] font-semibold uppercase tracking-widest text-tertiary">
            {doc.typeLabel}
          </div>
          <div className="tabular mt-0.5 text-[20px] font-semibold text-primary">{doc.number}</div>
          <div className="mt-2 flex justify-end">
            <Tag tone={STATUS_TONE[doc.status] ?? "neutral"} dot>
              {doc.status.replace("_", " ")}
            </Tag>
          </div>
          <dl className="mt-3 flex flex-col items-end gap-0.5 text-[11.5px]">
            <KV label="Issued" value={fmtDay(doc.issueDate)} />
            <KV label="Due" value={fmtDay(doc.dueDate)} />
            {doc.customerReference && <KV label="Your reference" value={doc.customerReference} />}
          </dl>
        </div>
      </header>

      {doc.profileMissing.length > 0 && commercial && (
        <div className="mt-4 rounded border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-warning-wash px-3 py-2 text-[11.5px] text-warning">
          This document is incomplete for the issuing company: {doc.profileMissing.join("; ")}.
          Fill these in under Billing settings before sending it.
        </div>
      )}

      {/* Parties and movement ---------------------------------------------- */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Block title="Bill to">
          <div className="text-[13px] font-medium text-primary">{doc.billTo.name}</div>
          {doc.billTo.addressLines && (
            <div className="mt-1 whitespace-pre-line text-[11.5px] leading-relaxed text-secondary">
              {doc.billTo.addressLines}
            </div>
          )}
          <dl className="mt-2 flex flex-col gap-0.5 text-[11.5px]">
            {doc.billTo.taxId && <KV label="VAT" value={doc.billTo.taxId} left />}
            {doc.billTo.country && <KV label="Country" value={doc.billTo.country} left />}
            {doc.billTo.email && <KV label="Email" value={doc.billTo.email} left />}
          </dl>
        </Block>

        {doc.shipment && (
          <Block title="Shipment">
            <dl className="flex flex-col gap-0.5 text-[11.5px]">
              <KV label="Reference" value={doc.shipment.reference} left mono />
              <KV
                label="Routing"
                value={`${doc.shipment.origin} → ${doc.shipment.destination}`}
                left
                mono
              />
              <KV label="Mode" value={doc.shipment.mode} left />
              {doc.shipment.incoterm && <KV label="Incoterm" value={doc.shipment.incoterm} left />}
              {/* The document AP matches on. Its absence is why forwarder
                  invoices sit in query queues. */}
              <KV
                label="Bill of lading"
                value={doc.shipment.transportDocumentRef || "Not recorded"}
                left
                mono
              />
              {doc.shipment.carrierBookingRef && (
                <KV label="Carrier booking" value={doc.shipment.carrierBookingRef} left mono />
              )}
              {doc.shipment.containers && doc.shipment.containers.length > 0 && (
                <KV
                  label="Containers"
                  value={doc.shipment.containers
                    .map((b) => b.number ?? `(${b.type ?? "unassigned"})`)
                    .join(", ")}
                  left
                  mono
                />
              )}
            </dl>
          </Block>
        )}
      </div>

      {doc.cargo && (
        <div className="mt-4 rounded border border-hairline bg-inset px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">
            Goods
          </div>
          <div className="mt-1 text-[12.5px] text-primary">{doc.cargo.description}</div>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-secondary">
            <span>{doc.cargo.pieces} pieces</span>
            <span>{kg(doc.cargo.grossWeightGrams)} gross</span>
            <span>{cbm(doc.cargo.volumeCm3)}</span>
            <span className="text-primary">{kg(doc.cargo.chargeableWeightGrams)} chargeable</span>
            {doc.cargo.marksAndNumbers && (
              <span className="mono text-tertiary">{doc.cargo.marksAndNumbers}</span>
            )}
          </div>
        </div>
      )}

      {/* Charges ----------------------------------------------------------- */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-strong text-[10px] font-semibold uppercase tracking-wider text-tertiary">
              <th className="py-2 pr-3 text-left">Charge</th>
              <th className="py-2 pr-3 text-left">Basis</th>
              <th className="py-2 pr-3 text-right">Qty</th>
              <th className="py-2 pr-3 text-right">Unit</th>
              {commercial && <th className="py-2 pr-3 text-right">Cost</th>}
              <th className="py-2 pr-3 text-right">Amount</th>
              <th className="py-2 pr-3 text-right">VAT</th>
            </tr>
          </thead>
          <tbody>
            {doc.sections.map((section) => (
              <SectionRows key={section.category} section={section} currency={c} commercial={commercial} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals ------------------------------------------------------------ */}
      <div className="mt-5 flex flex-col gap-5 border-t border-strong pt-4 sm:flex-row sm:justify-between">
        <div className="flex-1">
          {/* The split no forwarder invoice in the wild carries: what was
              advanced on the customer's behalf, what carries a margin, and
              what is the forwarder's own work. It is the answer to "what am I
              actually paying you for", printed rather than argued about. */}
          <div className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">
            How this invoice is made up
          </div>
          <div className="mt-2 flex flex-col gap-1 text-[11.5px]">
            <Split label="Disbursements, recovered at cost" cents={doc.totals.disbursementCents} currency={c} total={doc.totals.subtotalCents} />
            <Split label="Third-party services" cents={doc.totals.markedUpCents} currency={c} total={doc.totals.subtotalCents} />
            <Split label="Our own services" cents={doc.totals.forwarderOriginatedCents} currency={c} total={doc.totals.subtotalCents} />
          </div>

          {commercial && doc.margin.buyCents !== 0 && (
            <div className="mt-3 text-[11px] text-tertiary">
              Margin {money(doc.margin.marginCents, c)} on {money(doc.margin.buyCents, c)} of
              recorded cost ({(doc.margin.marginBps / 100).toFixed(1)}%)
              {doc.margin.linesWithoutBuy > 0 &&
                ` · ${doc.margin.linesWithoutBuy} line(s) have no recorded cost`}
            </div>
          )}
        </div>

        <dl className="w-full shrink-0 sm:w-72">
          <TotalRow label="Subtotal" value={money(doc.totals.subtotalCents, c)} />
          <TotalRow label="VAT" value={money(doc.totals.vatCents, c)} />
          <TotalRow label="Total" value={money(doc.totals.totalCents, c)} strong />
          {doc.totals.paidCents !== 0 && (
            <TotalRow label="Paid" value={`− ${money(doc.totals.paidCents, c)}`} />
          )}
          {doc.totals.paidCents !== 0 && (
            <TotalRow label="Balance due" value={money(doc.totals.outstandingCents, c)} strong />
          )}
          {doc.totals.disputedCents !== 0 && (
            <TotalRow
              label="Of which under query"
              value={money(doc.totals.disputedCents, c)}
              tone="warning"
            />
          )}
        </dl>
      </div>

      {doc.currencies.length > 1 && (
        <div className="mt-3 rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2 text-[11.5px] text-critical">
          This invoice carries lines in {doc.currencies.join(", ")}. The totals above are not
          meaningful until each currency is billed on its own document.
        </div>
      )}

      {/* Payment ----------------------------------------------------------- */}
      <div className="mt-6 grid gap-5 border-t border-hairline pt-4 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">
            Payment
          </div>
          <div className="mt-1.5 text-[12px] text-primary">{doc.paymentTermsLabel}</div>
          <dl className="mt-2 flex flex-col gap-0.5 text-[11.5px]">
            {doc.issuer.bankName && <KV label="Bank" value={doc.issuer.bankName} left />}
            {doc.issuer.bankAccountName && (
              <KV label="Account name" value={doc.issuer.bankAccountName} left />
            )}
            {doc.issuer.bankAccountNumber && (
              <KV label="Account" value={doc.issuer.bankAccountNumber} left mono />
            )}
            {doc.issuer.bankBranchCode && (
              <KV label="Branch" value={doc.issuer.bankBranchCode} left mono />
            )}
            {doc.issuer.bankSwift && <KV label="SWIFT" value={doc.issuer.bankSwift} left mono />}
            <KV label="Reference" value={doc.number} left mono />
          </dl>
          {!doc.issuer.bankAccountNumber && (
            <div className="mt-2 text-[11px] text-warning">
              No bank account is recorded on this invoice.
            </div>
          )}
        </div>

        <div className="text-[11px] leading-relaxed text-tertiary">
          {doc.notes && <p className="mb-2 text-secondary">{doc.notes}</p>}
          {doc.issuer.invoiceFooter && <p className="mb-2">{doc.issuer.invoiceFooter}</p>}
          {/* Printed on every document. A forwarder invoice used as a
              commercial invoice misdeclares the customs value of the goods,
              and it happens because nothing on the page says otherwise. */}
          <p className="border-t border-dotted border-hairline pt-2">{doc.documentNotice}</p>
        </div>
      </div>
    </article>
  );
}

function SectionRows({
  section,
  currency,
  commercial,
}: {
  section: InvoiceDocument["sections"][number];
  currency: string;
  commercial: boolean;
}) {
  return (
    <>
      <tr className="bg-inset">
        <td
          colSpan={commercial ? 7 : 6}
          className="py-1.5 pl-1 text-[10px] font-semibold uppercase tracking-widest text-tertiary"
        >
          {section.label}
        </td>
      </tr>
      {section.lines.map((line) => (
        <tr key={line.id} className="border-b border-hairline align-top">
          <td className="py-2 pr-3">
            <div className="flex items-center gap-2">
              <span className="mono text-[10.5px] text-tertiary">{line.chargeCode}</span>
              <span className="text-primary">{line.description}</span>
              {line.disputed && (
                <Tag tone="warning" className="ml-1">
                  Queried
                </Tag>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Tag tone={PROVENANCE_TONE[line.provenance]}>{PROVENANCE_LABEL[line.provenance]}</Tag>
              {commercial && line.vendorName && (
                <span className="text-[10.5px] text-tertiary">
                  {line.vendorName}
                  {line.vendorInvoiceRef ? ` · ${line.vendorInvoiceRef}` : ""}
                </span>
              )}
              {commercial && line.contractRef && (
                <span className="text-[10.5px] text-tertiary">{line.contractRef}</span>
              )}
            </div>
          </td>
          <td className="py-2 pr-3 text-secondary">per {BASIS_LABEL[line.basis] ?? line.basis}</td>
          <td className="tabular py-2 pr-3 text-right text-secondary">{line.quantity}</td>
          <td className="tabular py-2 pr-3 text-right text-secondary">
            {line.unitSellCents == null ? "—" : money(line.unitSellCents, currency)}
          </td>
          {commercial && (
            <td className="tabular py-2 pr-3 text-right text-tertiary">
              {line.buyCents == null ? "—" : money(line.buyCents, currency)}
            </td>
          )}
          <td className="tabular py-2 pr-3 text-right font-medium text-primary">
            {money(line.sellCents, line.currency)}
          </td>
          <td className="tabular py-2 pr-3 text-right text-secondary">
            {line.vatBps === 0 ? (
              <span className="text-[10.5px] text-tertiary">Zero-rated</span>
            ) : (
              money(line.vatCents, currency)
            )}
          </td>
        </tr>
      ))}
      <tr className="border-b border-strong">
        <td colSpan={commercial ? 5 : 4} className="py-1.5 pr-3 text-right text-[11px] text-tertiary">
          {section.label} subtotal
        </td>
        <td className="tabular py-1.5 pr-3 text-right text-[11.5px] font-medium text-primary">
          {money(section.subtotalCents, currency)}
        </td>
        <td className="tabular py-1.5 pr-3 text-right text-[11.5px] text-secondary">
          {money(section.vatCents, currency)}
        </td>
      </tr>
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-hairline bg-inset px-4 py-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-tertiary">
        {title}
      </div>
      {children}
    </div>
  );
}

function Reg({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label} <span className="mono text-secondary">{value}</span>
    </span>
  );
}

function KV({
  label,
  value,
  left,
  mono,
}: {
  label: string;
  value: string;
  left?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={`flex gap-3 ${left ? "justify-between" : "justify-end"}`}>
      <dt className="text-tertiary">{label}</dt>
      <dd className={`text-right text-primary ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}

function Split({
  label,
  cents,
  currency,
  total,
}: {
  label: string;
  cents: number;
  currency: string;
  total: number;
}) {
  const share = total === 0 ? 0 : Math.round((cents / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-56 shrink-0 text-secondary">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
        />
      </span>
      <span className="tabular w-32 shrink-0 text-right text-primary">{money(cents, currency)}</span>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "warning";
}) {
  return (
    <div
      className={`flex justify-between gap-4 border-b border-dotted border-hairline py-1.5 ${
        strong ? "text-[14px] font-semibold" : "text-[12px]"
      }`}
    >
      <dt className={tone === "warning" ? "text-warning" : "text-secondary"}>{label}</dt>
      <dd className={`tabular ${tone === "warning" ? "text-warning" : "text-primary"}`}>{value}</dd>
    </div>
  );
}
