import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { tenantBillingProfiles, tenants, type Db } from "@forge-freight/db";
import { DB } from "../db/db.module.js";

/**
 * Each company's own invoice identity.
 *
 * This is the difference between one forwarder's billing system and a platform
 * every forwarder can bill from. A company's registration number, VAT number,
 * customs client number, bank account, numbering series and payment terms all
 * appear on the document a customer pays from — get any of them from a shared
 * constant and the customer pays the wrong account or reclaims the wrong VAT.
 *
 * A tenant with no profile still has to be able to invoice, so `ensure` writes
 * a minimal one from the tenant's own name on first read. It is deliberately
 * incomplete rather than plausible: no bank details, no VAT number. An invoice
 * issued against it says clearly what is missing rather than printing somebody
 * else's account number.
 */
export interface BillingProfileInput {
  legalName?: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  customsClientNumber?: string | null;
  addressLines?: string | null;
  country?: string;
  email?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankBranchCode?: string | null;
  bankSwift?: string | null;
  invoiceNumberPrefix?: string;
  defaultPaymentTermsDays?: number;
  defaultCurrency?: string;
  vatBps?: number;
  invoiceFooter?: string | null;
}

export type BillingProfile = typeof tenantBillingProfiles.$inferSelect;

@Injectable()
export class BillingProfileService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The profile, creating a minimal one from the tenant name if absent. */
  async ensure(tenantId: string): Promise<BillingProfile> {
    const [existing] = await this.db
      .select()
      .from(tenantBillingProfiles)
      .where(eq(tenantBillingProfiles.tenantId, tenantId));
    if (existing) return existing;

    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new NotFoundException("Tenant not found");

    const [created] = await this.db
      .insert(tenantBillingProfiles)
      .values({ tenantId, legalName: tenant.name })
      // Two requests can race here on a tenant's very first invoice. Doing
      // nothing on conflict and re-reading is cheaper and safer than a lock.
      .onConflictDoNothing()
      .returning();

    if (created) return created;
    const [after] = await this.db
      .select()
      .from(tenantBillingProfiles)
      .where(eq(tenantBillingProfiles.tenantId, tenantId));
    return after!;
  }

  async update(tenantId: string, input: BillingProfileInput): Promise<BillingProfile> {
    await this.ensure(tenantId);
    const [updated] = await this.db
      .update(tenantBillingProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tenantBillingProfiles.tenantId, tenantId))
      .returning();
    return updated!;
  }

  /**
   * What is still missing before this company's invoices are complete.
   *
   * Surfaced rather than enforced. A forwarder mid-onboarding must be able to
   * issue an invoice today; what it must not do is issue one that looks
   * finished while carrying no bank account for the customer to pay into.
   */
  completeness(profile: BillingProfile): { ready: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!profile.registrationNumber) missing.push("Company registration number");
    if (!profile.vatNumber) missing.push("VAT registration number");
    if (!profile.addressLines) missing.push("Registered address");
    if (!profile.bankAccountNumber || !profile.bankName) missing.push("Bank account for payment");
    if (!profile.customsClientNumber) missing.push("Customs client number (needed to lodge declarations)");
    return { ready: missing.length === 0, missing };
  }

  /**
   * The next invoice number for this company, consumed atomically.
   *
   * `update ... returning` rather than a read-then-write: two invoices issued
   * in the same second must not both be numbered 000101. Must be called inside
   * the issuing transaction so a failed issue does not burn a number — several
   * jurisdictions require an issuer's invoice numbering to be gapless.
   */
  async nextNumber(tx: Db, tenantId: string, at: Date): Promise<string> {
    const [row] = await tx
      .update(tenantBillingProfiles)
      .set({
        nextInvoiceNumber: sql`${tenantBillingProfiles.nextInvoiceNumber} + 1` as unknown as number,
      })
      .where(eq(tenantBillingProfiles.tenantId, tenantId))
      .returning({
        prefix: tenantBillingProfiles.invoiceNumberPrefix,
        next: tenantBillingProfiles.nextInvoiceNumber,
      });
    if (!row) throw new NotFoundException("Billing profile not found");
    // `returning` gives the post-update value, so the number just consumed is
    // one below it.
    const consumed = row.next - 1;
    return `${row.prefix}-${at.getUTCFullYear()}-${String(consumed).padStart(6, "0")}`;
  }
}
