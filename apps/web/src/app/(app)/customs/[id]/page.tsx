import { api, fmtDate, money } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { CustomsStatusTag, Tag } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/empty-state";
import { ConfirmLineAction, EntryStageActions } from "@/components/forms/entry-actions";
import { ClassifyHelper } from "@/components/forms/classify-helper";

export const dynamic = "force-dynamic";

export default async function CustomsEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let error: string | null = null;
  const entry = await api.getEntry(id).catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return null;
  });

  const bureauPayload =
    entry && (entry.status === "SUBMITTED" || entry.status === "QUERY" || entry.status === "RELEASED" || entry.status === "STOPPED")
      ? await api.bureauPayload(id).catch(() => null)
      : null;

  const totalCents =
    entry?.dutiesTotalCents != null && entry?.vatTotalCents != null
      ? Number(entry.dutiesTotalCents) + Number(entry.vatTotalCents)
      : null;

  return (
    <div>
      <PageHeader
        eyebrow="Customs entry"
        title={id.slice(0, 8)}
        description={entry ? `Shipment ${entry.shipmentId.slice(0, 8)}` : undefined}
        actions={entry ? <CustomsStatusTag status={entry.status} /> : undefined}
      />

      {error && <ErrorState message={error} />}

      {entry && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Panel className="xl:col-span-3">
            <PanelHeader title="Lines" />
            <Table>
              <THead>
                <TR>
                  <TH>Description</TH>
                  <TH align="right">Value</TH>
                  <TH>HS code</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {(entry.lines ?? []).map((line) => (
                  <TR key={line.id}>
                    <TD className="text-secondary">{line.description}</TD>
                    <TD align="right" className="tabular">
                      {money(line.customsValueCents, entry.currency)}
                    </TD>
                    <TD>
                      {line.hsCode ? (
                        <Mono className="text-primary">{line.hsCode}</Mono>
                      ) : (
                        <span className="text-tertiary">—</span>
                      )}
                      {line.hsConfidence != null && (
                        <span className="ml-1.5 text-[10.5px] text-tertiary">
                          {(line.hsConfidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </TD>
                    <TD>
                      {line.confirmedAt ? (
                        <Tag tone="success">Confirmed</Tag>
                      ) : entry.status === "DRAFT" ? (
                        <ConfirmLineAction entryId={entry.id} line={line} />
                      ) : (
                        <Tag tone="warning">Unconfirmed</Tag>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>

            {entry.status === "DRAFT" && (
              <div className="mt-4">
                <ClassifyHelper />
              </div>
            )}

            {totalCents != null && (
              <div className="mt-4 flex flex-col gap-1 border-t border-hairline pt-3 text-[12.5px]">
                <div className="flex justify-between text-secondary">
                  <span>Duty</span>
                  <span className="tabular">{money(entry.dutiesTotalCents, entry.currency)}</span>
                </div>
                <div className="flex justify-between text-secondary">
                  <span>VAT</span>
                  <span className="tabular">{money(entry.vatTotalCents, entry.currency)}</span>
                </div>
                <div className="flex justify-between font-semibold text-primary">
                  <span>Total liability</span>
                  <span className="tabular text-accent-strong">{money(totalCents, entry.currency)}</span>
                </div>
              </div>
            )}
          </Panel>

          <div className="flex flex-col gap-4 xl:col-span-2">
            <Panel>
              <PanelHeader title="Workflow" eyebrow={entry.status} />
              <EntryStageActions entry={entry} />
            </Panel>

            {(entry.bureauRef || entry.releaseRef) && (
              <Panel>
                <PanelHeader title="References" />
                <div className="flex flex-col gap-2 text-[12.5px]">
                  {entry.bureauRef && (
                    <div className="flex justify-between">
                      <span className="text-secondary">Bureau ref</span>
                      <Mono>{entry.bureauRef}</Mono>
                    </div>
                  )}
                  {entry.releaseRef && (
                    <div className="flex justify-between">
                      <span className="text-secondary">Release ref</span>
                      <Mono>{entry.releaseRef}</Mono>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-secondary">Created</span>
                    <span>{fmtDate(entry.createdAt)}</span>
                  </div>
                </div>
              </Panel>
            )}

            {bureauPayload != null && (
              <Panel>
                <PanelHeader title="Bureau payload" eyebrow="forge-freight/customs-entry@1" />
                <pre className="max-h-64 overflow-auto rounded bg-inset p-3 text-[10.5px] leading-relaxed text-secondary">
                  {JSON.stringify(bureauPayload, null, 2)}
                </pre>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
