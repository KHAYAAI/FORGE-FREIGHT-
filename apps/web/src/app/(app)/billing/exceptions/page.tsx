import Link from "next/link";
import { api } from "@/lib/api";
import { money, relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Tag, type Tone } from "@/components/ui/badge";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: "critical",
  WARN: "warning",
  INFO: "neutral",
};

const STATUS_TONE: Record<string, Tone> = {
  OPEN: "warning",
  DISPUTED: "critical",
  ACCEPTED: "neutral",
  RESOLVED: "success",
};

/**
 * Every audit finding across the book, not one invoice at a time.
 *
 * The reason this screen exists separately from the invoice: a $40 terminal
 * handling overcharge on one container is beneath anyone's review threshold.
 * The same $40 on every container through one port for a year is the largest
 * single recoverable number a forwarder has. That pattern is invisible from
 * invoice-level review and obvious from here — which is why the first thing
 * this page shows is findings grouped by rule, and only then the list.
 */
export default async function ExceptionsPage() {
  let error: string | null = null;
  const rows = await api.allExceptions().catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  const open = rows.filter(
    (r) => r.exception.status === "OPEN" || r.exception.status === "DISPUTED",
  );
  const critical = open.filter((r) => r.exception.severity === "CRITICAL");
  const queryable = open.reduce((s, r) => s + Math.max(0, r.exception.varianceCents ?? 0), 0);

  // Grouped by rule, ordered by money. This is the portfolio view: the same
  // rule firing on twenty invoices is a systematic billing pattern, not twenty
  // coincidences, and it is worth a conversation with the vendor rather than
  // twenty separate queries.
  const byCode = new Map<string, { count: number; cents: number; severity: string }>();
  for (const { exception } of open) {
    const prior = byCode.get(exception.code) ?? { count: 0, cents: 0, severity: exception.severity };
    byCode.set(exception.code, {
      count: prior.count + 1,
      cents: prior.cents + Math.max(0, exception.varianceCents ?? 0),
      severity: exception.severity === "CRITICAL" ? "CRITICAL" : prior.severity,
    });
  }
  const patterns = [...byCode.entries()].sort((a, b) => b[1].cents - a[1].cents || b[1].count - a[1].count);

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Invoice exceptions"
        description="Findings from the four-way match across every invoice on the book. Raised before payment, because a dispute filed after the window closes is a write-off however good the evidence."
      />

      {error && <ErrorState message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Open findings" value={open.length} tone={open.length > 0 ? "warning" : "success"} />
        <StatTile
          label="Critical"
          value={critical.length}
          tone={critical.length > 0 ? "critical" : "success"}
        />
        <StatTile
          label="Queryable"
          value={queryable === 0 ? "—" : money(queryable, "ZAR")}
          tone={queryable > 0 ? "warning" : "success"}
        />
        <StatTile label="Distinct rules firing" value={patterns.length} />
      </div>

      {patterns.length > 0 && (
        <div className="mb-5">
          <Panel>
            <PanelHeader
              eyebrow="Portfolio view"
              title="Patterns"
              actions={<span className="text-[11px] text-tertiary">By recoverable value</span>}
            />
            <div className="flex flex-col gap-2">
              {patterns.map(([code, p]) => (
                <div
                  key={code}
                  className="flex flex-wrap items-center gap-3 rounded border border-hairline bg-inset px-3 py-2"
                >
                  <Tag tone={SEVERITY_TONE[p.severity] ?? "neutral"} dot>
                    {p.severity}
                  </Tag>
                  <Mono className="text-[11px] text-primary">{code}</Mono>
                  <span className="text-[11.5px] text-secondary">
                    on {p.count} invoice{p.count === 1 ? "" : "s"}
                  </span>
                  {p.cents > 0 && (
                    <span className="tabular ml-auto text-[12.5px] font-semibold text-warning">
                      {money(p.cents, "ZAR")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <Panel>
        <PanelHeader title="All findings" eyebrow="Newest first" />
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing found yet"
            description="Open an invoice and run the audit. Findings from every invoice collect here."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Rule</TH>
                  <TH>Severity</TH>
                  <TH>Status</TH>
                  <TH align="right">Variance</TH>
                  <TH>Finding</TH>
                  <TH>Found</TH>
                </TR>
              </THead>
              <tbody>
                {rows.map(({ exception: e, invoiceNumber }) => (
                  <TR key={e.id}>
                    <TD>
                      <Link
                        href={`/invoices/${e.invoiceId}`}
                        className="text-accent hover:underline"
                      >
                        <Mono>{invoiceNumber ?? "—"}</Mono>
                      </Link>
                    </TD>
                    <TD>
                      <Mono className="text-secondary">{e.code}</Mono>
                    </TD>
                    <TD>
                      <Tag tone={SEVERITY_TONE[e.severity] ?? "neutral"} dot>
                        {e.severity}
                      </Tag>
                    </TD>
                    <TD>
                      <Tag tone={STATUS_TONE[e.status] ?? "neutral"}>{e.status}</Tag>
                    </TD>
                    <TD align="right" className="tabular">
                      {e.varianceCents == null ? (
                        <span className="text-tertiary">—</span>
                      ) : (
                        <span className={e.varianceCents > 0 ? "text-warning" : "text-secondary"}>
                          {money(e.varianceCents, "ZAR")}
                        </span>
                      )}
                    </TD>
                    <TD className="max-w-[420px] text-secondary">{e.message}</TD>
                    <TD className="text-tertiary">{relativeTime(e.detectedAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}
