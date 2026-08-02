import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import { Tag, type Tone } from "@/components/ui/badge";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { BillingProfileForm } from "@/components/forms/billing-profile-form";

export const dynamic = "force-dynamic";

const ERROR_TONE: Record<string, Tone> = {
  HIGH: "critical",
  MEDIUM: "warning",
  LOW: "neutral",
};

const PROVENANCE_LABEL: Record<string, string> = {
  PASS_THROUGH: "At cost",
  MARKED_UP: "Third party",
  FORWARDER_ORIGINATED: "Our service",
};

/**
 * Billing settings: who this company is on an invoice, and the charge
 * vocabulary the platform reasons over.
 *
 * The code list is shown, not hidden, because the taxonomy is the contract
 * between what an operator types and what the audit can check. An operator who
 * can see that BAF, THC and DOC are the high-error codes will look at them
 * first, which is the whole point of marking them.
 */
export default async function BillingSettingsPage() {
  let error: string | null = null;

  const [profile, codes] = await Promise.all([
    api.billingProfile().catch((e) => {
      error = e instanceof Error ? e.message : String(e);
      return null;
    }),
    api.chargeCodes().catch(() => ({ codes: [], categories: [] })),
  ]);

  if (!profile) return <ErrorState message={error ?? "Could not load the billing profile"} />;

  const byCategory = new Map<string, typeof codes.codes>();
  for (const code of codes.codes) {
    byCategory.set(code.category, [...(byCategory.get(code.category) ?? []), code]);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Billing settings"
        description="Your company's invoice identity, numbering and charge vocabulary. Every invoice you issue carries these details, and no other company on the platform shares them."
      />

      {error && <ErrorState message={error} />}

      <div className="mb-6">
        <BillingProfileForm profile={profile} />
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Standard taxonomy"
          title="Charge codes"
          actions={
            <span className="text-[11px] text-tertiary">{codes.codes.length} codes</span>
          }
        />
        <p className="mb-4 text-[11.5px] leading-relaxed text-tertiary">
          One vendor writes &ldquo;OHC&rdquo;, the next writes &ldquo;origin handling&rdquo;, a
          third bundles it into the freight charge. Every spelling collapses onto one of these
          codes before anything is compared, priced or analysed. Codes marked{" "}
          <Tag tone="critical">HIGH</Tag> carry the highest documented billing error rates: they get
          the least scrutiny from accounts payable and leave the most discretion to whoever raised
          the line.
        </p>

        <div className="flex flex-col gap-5">
          {codes.categories
            .filter((c) => byCategory.has(c.code))
            .map((category) => (
              <div key={category.code}>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-tertiary">
                  {category.label}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Code</TH>
                        <TH>Charge</TH>
                        <TH>Billed per</TH>
                        <TH>Normally</TH>
                        <TH>VAT</TH>
                        <TH>Error rate</TH>
                      </TR>
                    </THead>
                    <tbody>
                      {(byCategory.get(category.code) ?? []).map((code) => (
                        <TR key={code.code}>
                          <TD>
                            <Mono className="text-primary">{code.code}</Mono>
                          </TD>
                          <TD className="text-primary">
                            {code.label}
                            {code.note && (
                              <div className="mt-0.5 text-[11px] leading-relaxed text-tertiary">
                                {code.note}
                              </div>
                            )}
                          </TD>
                          <TD className="text-secondary">
                            {code.basis.replace("PER_", "").toLowerCase()}
                          </TD>
                          <TD className="text-secondary">
                            {PROVENANCE_LABEL[code.typicalProvenance] ?? code.typicalProvenance}
                          </TD>
                          <TD className="text-secondary">
                            {code.taxable ? "Taxable" : "Outside scope"}
                          </TD>
                          <TD>
                            <Tag tone={ERROR_TONE[code.errorRate] ?? "neutral"}>
                              {code.errorRate}
                            </Tag>
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}
