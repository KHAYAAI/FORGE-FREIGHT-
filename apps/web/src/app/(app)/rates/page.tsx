import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState, InfoBanner } from "@/components/ui/empty-state";
import { RateCardsManager } from "@/components/forms/rate-cards-manager";
import { withValidity } from "@/lib/rate-validity";
import { MarginRulesManager } from "@/components/forms/margin-rules-manager";

export const dynamic = "force-dynamic";

/**
 * The buy side of the business. Until this screen existed, pricing a new lane
 * meant an operator writing INSERTs against `rate_cards` by hand — which made
 * onboarding a corridor an engineering task rather than a commercial one, and
 * left partner agents unable to run their own book at all.
 */
export default async function RatesPage() {
  let error: string | null = null;
  const fail = (e: unknown) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  };

  const [cards, rules, parties] = await Promise.all([
    api.rateCards().catch(fail),
    api.marginRules().catch(fail),
    api.listParties().catch(() => []),
  ]);

  const noCatchAll =
    rules.length > 0 && !rules.some((r) => !r.customerId && !r.origin && !r.destination && !r.mode);

  // Two rules covering exactly the same scope resolve by recency, so the older
  // one silently never applies. Say so rather than let someone wonder why the
  // margin they set is not the margin they get.
  const scopes = new Map<string, number>();
  for (const r of rules) {
    const key = `${r.customerId ?? ""}|${r.origin ?? ""}|${r.destination ?? ""}|${r.mode ?? ""}`;
    scopes.set(key, (scopes.get(key) ?? 0) + 1);
  }
  const overlapping = [...scopes.values()].filter((n) => n > 1).length;

  return (
    <div>
      <PageHeader
        eyebrow="Commercial"
        title="Rates"
        description="What freight costs you, and what you charge on top of it. Quoting reads straight from here."
      />

      {error && <ErrorState message={error} />}

      {rules.length === 0 && !error && (
        <InfoBanner>
          There are no margin rules, so <strong>every quote will fail</strong>. Add a catch-all
          rule below before pricing anything.
        </InfoBanner>
      )}
      {noCatchAll && (
        <InfoBanner>
          No catch-all margin rule: any lane not covered by a rule below will be{" "}
          <strong>refused at quote time</strong> rather than priced at a default.
        </InfoBanner>
      )}

      {overlapping > 0 && (
        <InfoBanner>
          {overlapping === 1 ? "One scope has" : `${overlapping} scopes have`} more than one margin
          rule. Ties resolve to the <strong>most recently created</strong> rule, so the older one
          never applies — remove it rather than leave it looking active.
        </InfoBanner>
      )}

      <div className="flex flex-col gap-4">
        <RateCardsManager cards={withValidity(cards)} />
        <MarginRulesManager rules={rules} parties={parties} />
      </div>
    </div>
  );
}
