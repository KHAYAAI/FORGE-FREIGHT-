import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Tag, type Tone } from "@/components/ui/badge";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, Tone> = {
  CONFIGURED: "success",
  PARTIAL: "warning",
  NOT_CONFIGURED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  CONFIGURED: "Live",
  PARTIAL: "Partial",
  NOT_CONFIGURED: "Not configured",
};

const FILING_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  QUEUED: "warning",
  SUBMITTED: "info",
  ACKNOWLEDGED: "info",
  QUERIED: "warning",
  ACCEPTED: "success",
  REJECTED: "critical",
};

/**
 * What this deployment can and cannot reach.
 *
 * A freight forwarder operates inside other people's systems — the revenue
 * authority, the carrier, the terminal, the index publisher — and several of
 * those cannot be switched on with a URL. They need a registration, an
 * accreditation or a certificate that a person has to go and apply for, and
 * the honest thing to do is say so on a screen rather than let a dark
 * integration look like a bug.
 *
 * So each row states what breaks without it, what configuration it needs, and
 * the out-of-band step if there is one. Nothing here reports a secret's value,
 * only whether a named key is set.
 */
export default async function IntegrationsPage() {
  let error: string | null = null;

  const [overview, filings] = await Promise.all([
    api.integrations().catch((e) => {
      error = e instanceof Error ? e.message : String(e);
      return null;
    }),
    api.filings().catch(() => ({ filings: [], channel: { enabled: false, missing: [] } })),
  ]);

  if (!overview) return <ErrorState message={error ?? "Could not read integration status"} />;

  const byDomain = new Map<string, typeof overview.integrations>();
  for (const integration of overview.integrations) {
    byDomain.set(integration.domain, [...(byDomain.get(integration.domain) ?? []), integration]);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="External systems"
        description="Every system outside this platform that it talks to, what it is for, and what it degrades to when it is dark."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Integrations" value={overview.summary.total} />
        <StatTile
          label="Live"
          value={overview.summary.configured}
          tone={overview.summary.configured > 0 ? "success" : "neutral"}
        />
        <StatTile
          label="Blocking production"
          value={overview.summary.blockingProduction.length}
          tone={overview.summary.blockingProduction.length > 0 ? "critical" : "success"}
          sub={overview.summary.blockingProduction.slice(0, 2).join(", ") || undefined}
        />
        <StatTile
          label="Need accreditation"
          value={overview.summary.needingAccreditation.length}
          tone={overview.summary.needingAccreditation.length > 0 ? "warning" : "success"}
        />
      </div>

      {overview.summary.needingAccreditation.length > 0 && (
        <div className="mb-5 rounded border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-warning-wash px-4 py-3">
          <div className="text-[12px] font-semibold text-warning">
            These cannot be enabled by configuration alone
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-warning">
            Each of the following needs a registration, licence or certificate that a person has to
            apply for. The platform is wired for all of them — the work outstanding is paperwork,
            not code.
          </p>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-5">
        {[...byDomain.entries()].map(([domain, items]) => (
          <Panel key={domain}>
            <PanelHeader eyebrow="Domain" title={domain} />
            <div className="flex flex-col gap-3">
              {items.map((i) => (
                <div key={i.key} className="rounded border border-hairline bg-inset px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-primary">{i.name}</span>
                    <Tag tone={STATUS_TONE[i.status] ?? "neutral"} dot>
                      {STATUS_LABEL[i.status] ?? i.status}
                    </Tag>
                    {i.requiredForProduction && i.status !== "CONFIGURED" && (
                      <Tag tone="critical">Required for production</Tag>
                    )}
                    <span className="ml-auto text-[11px] text-tertiary">{i.provider}</span>
                  </div>

                  <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">{i.purpose}</p>

                  {i.status !== "CONFIGURED" && (
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-tertiary">
                      <span className="text-secondary">Without it:</span> {i.degradesTo}
                    </p>
                  )}

                  {i.accreditation && (
                    <p className="mt-1.5 rounded border border-dotted border-hairline px-2.5 py-1.5 text-[11.5px] leading-relaxed text-warning">
                      <span className="font-semibold">Accreditation required.</span>{" "}
                      {i.accreditation}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {i.requires.map((key) => (
                      <Mono
                        key={key}
                        className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${
                          i.missing.includes(key)
                            ? "border-hairline text-tertiary"
                            : "border-[color-mix(in_srgb,var(--success)_35%,transparent)] text-success"
                        }`}
                      >
                        {key}
                      </Mono>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <Panel>
        <PanelHeader
          eyebrow="SARS"
          title="Statutory filings"
          actions={
            <Tag tone={filings.channel.enabled ? "success" : "warning"} dot>
              {filings.channel.enabled ? "Channel live" : "Queued locally"}
            </Tag>
          }
        />
        {!filings.channel.enabled && (
          <p className="mb-3 text-[11.5px] leading-relaxed text-tertiary">
            Declarations are built, validated against the tariff book and stored complete. They stop
            at <Mono>QUEUED</Mono> and are exported for manual capture until the EDI channel is
            configured — missing: {filings.channel.missing.join(", ") || "—"}.
          </p>
        )}
        {filings.filings.length === 0 ? (
          <EmptyState
            title="No filings yet"
            description="Declarations lodged from the customs workspace appear here with their full submission history."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Kind</TH>
                  <TH>Status</TH>
                  <TH>Our reference</TH>
                  <TH>Authority reference</TH>
                  <TH>Submitted</TH>
                  <TH>Note</TH>
                </TR>
              </THead>
              <tbody>
                {filings.filings.map((f) => (
                  <TR key={f.id}>
                    <TD>
                      <Mono className="text-primary">{f.kind}</Mono>
                    </TD>
                    <TD>
                      <Tag tone={FILING_TONE[f.status] ?? "neutral"} dot>
                        {f.status}
                      </Tag>
                    </TD>
                    <TD>
                      <Mono className="text-secondary">{f.submissionRef ?? "—"}</Mono>
                    </TD>
                    <TD>
                      <Mono className="text-secondary">{f.authorityRef ?? "—"}</Mono>
                    </TD>
                    <TD className="text-tertiary">
                      {f.submittedAt ? fmtDate(f.submittedAt) : "—"}
                    </TD>
                    <TD className="max-w-[420px] text-tertiary">{f.lastError ?? "—"}</TD>
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
