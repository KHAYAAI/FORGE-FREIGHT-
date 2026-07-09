import { api, fmtDate, relativeTime } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { Tag } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/empty-state";
import { BarRow } from "@/components/ui/bar-row";
import { AutoRefresh } from "@/components/shell/auto-refresh";

export const dynamic = "force-dynamic";

function InfraLight({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded border border-hairline px-3 py-2.5">
      <span className="text-[12px] text-secondary">{label}</span>
      <Tag tone={ok ? "success" : "critical"} dot>
        {ok ? "Online" : "Offline"}
      </Tag>
    </div>
  );
}

export default async function SystemMonitorPage() {
  let error: string | null = null;
  const monitor = await api.systemMonitor().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return null;
  });

  const shipmentMax = Math.max(1, ...(monitor?.entities.shipmentsByStatus.map((r) => r.n) ?? [0]));
  const customsMax = Math.max(1, ...(monitor?.entities.customsByStatus.map((r) => r.n) ?? [0]));

  return (
    <div>
      <AutoRefresh intervalMs={10_000} />
      <PageHeader
        eyebrow="Overview"
        title="System Monitor"
        description="Event throughput, consumer lag, and infrastructure health — refreshes every 10s."
        actions={
          monitor && (
            <span className="text-[11px] text-tertiary">
              Generated {relativeTime(monitor.generatedAt)}
            </span>
          )
        }
      />

      {error && <ErrorState message={error} />}
      {!monitor && !error && (
        <div className="py-12 text-center text-[12.5px] text-tertiary">Loading…</div>
      )}

      {monitor && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Total events" value={monitor.events.total} />
            <StatTile label="Events / hour" value={monitor.events.lastHour} tone="accent" />
            <StatTile
              label="Outbox backlog"
              value={monitor.events.outboxUnpublished}
              tone={monitor.events.outboxUnpublished > 50 ? "warning" : "neutral"}
            />
            <StatTile
              label="Open exceptions"
              value={monitor.exceptions.total}
              tone={monitor.exceptions.total > 0 ? "critical" : "success"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Panel className="xl:col-span-2">
              <PanelHeader title="Infrastructure" />
              <div className="flex flex-col gap-2">
                <InfraLight label="Database" ok={monitor.infra.database} />
                <InfraLight label="Kafka / Redpanda outbox" ok={monitor.infra.kafkaConfigured} />
                <InfraLight label="Temporal workflows" ok={monitor.infra.temporalConfigured} />
              </div>
              <div className="mt-3 text-[11px] text-tertiary">
                Outbox poll interval: <span className="tabular text-secondary">{monitor.infra.outboxPollMs}ms</span>
              </div>
            </Panel>

            <Panel className="xl:col-span-3">
              <PanelHeader title="Event consumers" eyebrow="Watermarked, replay-safe" />
              <Table>
                <THead>
                  <TR>
                    <TH>Consumer</TH>
                    <TH>Last event</TH>
                    <TH align="right">Lag</TH>
                    <TH align="right">Status</TH>
                  </TR>
                </THead>
                <tbody>
                  {monitor.consumers.map((c) => (
                    <TR key={c.name}>
                      <TD className="font-medium text-primary">{c.name}</TD>
                      <TD className="text-secondary">{fmtDate(c.lastRecordedAt)}</TD>
                      <TD align="right" className="tabular text-secondary">
                        {c.lagMs === null ? "—" : `${Math.round(c.lagMs / 1000)}s`}
                      </TD>
                      <TD align="right">
                        <Tag tone={c.healthy ? "success" : "critical"} dot>
                          {c.healthy ? "Healthy" : "Lagging"}
                        </Tag>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Panel>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader title="Shipments by status" />
              <div className="flex flex-col gap-2.5">
                {monitor.entities.shipmentsByStatus.length === 0 ? (
                  <div className="py-4 text-center text-[12px] text-tertiary">No shipments yet.</div>
                ) : (
                  monitor.entities.shipmentsByStatus.map((r) => (
                    <BarRow key={r.status} label={r.status.replaceAll("_", " ")} value={r.n} max={shipmentMax} />
                  ))
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Customs entries by status" />
              <div className="flex flex-col gap-2.5">
                {monitor.entities.customsByStatus.length === 0 ? (
                  <div className="py-4 text-center text-[12px] text-tertiary">No customs entries yet.</div>
                ) : (
                  monitor.entities.customsByStatus.map((r) => (
                    <BarRow
                      key={r.status}
                      label={r.status}
                      value={r.n}
                      max={customsMax}
                      tone={r.status === "QUERY" || r.status === "STOPPED" ? "warning" : "accent"}
                    />
                  ))
                )}
              </div>
            </Panel>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label="Documents in review" value={monitor.entities.documentsInReview} tone={monitor.entities.documentsInReview > 0 ? "warning" : "neutral"} />
            <StatTile label="Invoices outstanding" value={monitor.entities.invoicesOutstanding} />
            <StatTile label="Parties on file" value={monitor.entities.parties} />
          </div>

          {monitor.exceptions.byCode.length > 0 && (
            <Panel className="mt-4">
              <PanelHeader title="Exception backlog by code" />
              <div className="flex flex-wrap gap-2">
                {monitor.exceptions.byCode.map((e) => (
                  <div key={e.code} className="flex items-center gap-2 rounded border border-hairline px-3 py-1.5">
                    <span className="text-[11.5px] text-secondary">{e.code.replaceAll("_", " ")}</span>
                    <Mono className="text-primary">{e.n}</Mono>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
