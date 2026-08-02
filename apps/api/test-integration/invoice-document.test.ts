import { NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  chargeCodeAliases,
  charges,
  invoiceExceptions,
  invoices,
  payments,
  tenantBillingProfiles,
  type Db,
} from "@forge-freight/db";
import { BillingController } from "../src/modules/billing/billing.controller.js";
import { BillingProfileService } from "../src/modules/billing/billing-profile.service.js";
import { BillingService } from "../src/modules/billing/billing.service.js";
import { InvoiceAssemblyService } from "../src/modules/billing/invoice-assembly.service.js";
import { FuelIndexService } from "../src/modules/integrations/fuel-index.service.js";
import { TerminalEventsService } from "../src/modules/integrations/terminal-events.service.js";
import { loadConfig } from "../src/config.js";
import {
  createShipments,
  createTenantFixture,
  dropTenantFixture,
  testDb,
  type Fixture,
} from "./harness.js";

/**
 * The standardised invoice, end to end against a real database.
 *
 * The pure modules are unit-tested; what only a database can show is that two
 * companies issuing at the same moment get their own numbering, that one
 * tenant cannot read another's document, and that re-running an audit updates
 * findings rather than accumulating copies of them.
 */

let db: Db;
let acme: Fixture;
let rival: Fixture;
let controller: BillingController;
let profiles: BillingProfileService;
let assembly: InvoiceAssemblyService;
let acmeShipment: string;

const auth = (tenantId: string) => ({
  tenantId,
  userId: "invoice-test",
  roles: ["finance", "ops"],
});

const line = (over: Record<string, unknown> = {}) => ({
  chargeCode: "FRT",
  description: "Ocean freight",
  kind: "FREIGHT" as const,
  category: "FREIGHT" as const,
  provenance: "MARKED_UP" as const,
  basis: "PER_CONTAINER" as const,
  quantity: 2,
  unitSellCents: 185_000,
  buyCents: 310_000,
  currency: "ZAR",
  vatBps: 1500,
  ...over,
});

beforeAll(async () => {
  db = testDb();
  acme = await createTenantFixture(db, "inv-acme");
  rival = await createTenantFixture(db, "inv-rival");

  const cfg = loadConfig({ ...process.env, AUTH_MODE: "dev" });
  profiles = new BillingProfileService(db);
  assembly = new InvoiceAssemblyService(
    db,
    profiles,
    new FuelIndexService(db, cfg),
    new TerminalEventsService(db, cfg),
  );
  controller = new BillingController(
    new BillingService(db, profiles),
    profiles,
    assembly,
    db,
  );

  [acmeShipment] = await createShipments(db, acme, [{ origin: "CNSHA", destination: "ZADUR" }]);
});

afterAll(async () => {
  for (const t of [acme.tenantId, rival.tenantId]) {
    const ids = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.tenantId, t));
    if (ids.length > 0) {
      await db.delete(invoiceExceptions).where(inArray(invoiceExceptions.invoiceId, ids.map((i) => i.id)));
      await db.delete(payments).where(inArray(payments.invoiceId, ids.map((i) => i.id)));
    }
    await db.delete(chargeCodeAliases).where(eq(chargeCodeAliases.tenantId, t));
    await db.delete(charges).where(eq(charges.tenantId, t));
    await db.delete(invoices).where(eq(invoices.tenantId, t));
    await db.delete(tenantBillingProfiles).where(eq(tenantBillingProfiles.tenantId, t));
  }
  await dropTenantFixture(db, acme);
  await dropTenantFixture(db, rival);
});

describe("the issuing company's identity", () => {
  it("creates a minimal profile rather than refusing to invoice", async () => {
    // A forwarder mid-onboarding must be able to bill today. What it must not
    // do is print somebody else's bank account.
    const profile = await controller.profile(auth(acme.tenantId));
    expect(profile.legalName).toContain("test-inv-acme");
    expect(profile.completeness.ready).toBe(false);
    expect(profile.completeness.missing).toContain("Bank account for payment");
    expect(profile.bankAccountNumber).toBeNull();
  });

  it("keeps each company's details to itself", async () => {
    await controller.updateProfile(
      { legalName: "Acme Forwarding (Pty) Ltd", vatNumber: "4111111111", bankAccountNumber: "999" },
      auth(acme.tenantId),
    );
    const theirs = await controller.profile(auth(rival.tenantId));
    expect(theirs.legalName).not.toBe("Acme Forwarding (Pty) Ltd");
    expect(theirs.vatNumber).toBeNull();
  });

  it("refuses a numbering prefix that would make the series unparseable", async () => {
    await expect(
      controller.updateProfile({ invoiceNumberPrefix: "AC-ME/1" }, auth(acme.tenantId)),
    ).rejects.toThrow();
  });
});

describe("issuing", () => {
  it("numbers invoices per company, from that company's own series", async () => {
    // Not a shared sequence: several jurisdictions require an issuer's invoice
    // numbering to be sequential and gapless, and a shared one hands company B
    // the numbers company A did not use.
    await controller.updateProfile({ invoiceNumberPrefix: "ACME" }, auth(acme.tenantId));
    await controller.addCharge(acmeShipment, line(), auth(acme.tenantId));

    const first = await controller.issue(acmeShipment, {}, auth(acme.tenantId));
    expect(first.invoices[0]!.number).toMatch(/^ACME-\d{4}-000001$/);

    await controller.addCharge(acmeShipment, line({ description: "Second job" }), auth(acme.tenantId));
    const second = await controller.issue(acmeShipment, {}, auth(acme.tenantId));
    expect(second.invoices[0]!.number).toMatch(/^ACME-\d{4}-000002$/);

    // A different company starts at 1 regardless of what anyone else issued.
    const [rivalShipment] = await createShipments(db, rival, [
      { origin: "CNSHA", destination: "ZADUR" },
    ]);
    await controller.updateProfile({ invoiceNumberPrefix: "RIV" }, auth(rival.tenantId));
    await controller.addCharge(rivalShipment!, line(), auth(rival.tenantId));
    const theirs = await controller.issue(rivalShipment!, {}, auth(rival.tenantId));
    expect(theirs.invoices[0]!.number).toMatch(/^RIV-\d{4}-000001$/);
  });

  it("computes VAT per line and states the totals separately", async () => {
    await controller.addCharge(
      acmeShipment,
      line({ description: "Freight for VAT test" }),
      auth(acme.tenantId),
    );
    await controller.addCharge(
      acmeShipment,
      line({
        chargeCode: "DTY",
        description: "Duty",
        kind: "DISBURSEMENT",
        category: "DUTY_TAX",
        provenance: "PASS_THROUGH",
        basis: "PER_SHIPMENT",
        quantity: 1,
        unitSellCents: 500_000,
        buyCents: 500_000,
        vatBps: 0,
      }),
      auth(acme.tenantId),
    );
    const issued = await controller.issue(acmeShipment, {}, auth(acme.tenantId));
    const inv = issued.invoices[0]!;
    // 370,000 taxable at 15% = 55,500. The duty is outside the scope of VAT.
    expect(inv.subtotalCents).toBe(870_000);
    expect(inv.vatCents).toBe(55_500);
    expect(inv.totalCents).toBe(925_500);
  });

  it("refuses a pass-through line billed above its own cost", async () => {
    // The mislabelling has to be caught at the door: once the invoice is out,
    // the argument is with the customer rather than with the person typing.
    await expect(
      controller.addCharge(
        acmeShipment,
        line({
          provenance: "PASS_THROUGH",
          quantity: 1,
          unitSellCents: 400_000,
          buyCents: 310_000,
        }),
        auth(acme.tenantId),
      ),
    ).rejects.toThrow();
  });
});

describe("the document", () => {
  let invoiceId: string;

  beforeAll(async () => {
    await controller.updateProfile(
      {
        legalName: "Acme Forwarding (Pty) Ltd",
        vatNumber: "4111111111",
        customsClientNumber: "20418877",
        bankName: "Standard Bank",
        bankAccountNumber: "042 118 774",
        addressLines: "1 Bayhead Road, Durban",
        registrationNumber: "2019/1/07",
      },
      auth(acme.tenantId),
    );
    await controller.addCharge(
      acmeShipment,
      line({ description: "Freight for document test" }),
      auth(acme.tenantId),
    );
    const issued = await controller.issue(
      acmeShipment,
      { transportDocumentRef: "MAEU111", customerReference: "PO-1" },
      auth(acme.tenantId),
    );
    invoiceId = issued.invoices[0]!.invoiceId;
  });

  it("carries the issuer's registrations and the references AP matches on", async () => {
    const doc = await controller.document(invoiceId, auth(acme.tenantId));
    expect(doc.issuer.vatNumber).toBe("4111111111");
    expect(doc.issuer.customsClientNumber).toBe("20418877");
    expect(doc.shipment?.transportDocumentRef).toBe("MAEU111");
    expect(doc.customerReference).toBe("PO-1");
    expect(doc.documentNotice).toMatch(/not a commercial invoice/i);
  });

  it("keeps saying what it said, after the company changes its details", async () => {
    // A reissued PDF that disagrees with the one the customer holds is a tax
    // problem in every jurisdiction this runs in.
    await controller.updateProfile(
      { bankAccountNumber: "111 999 000", legalName: "Acme Global Forwarding" },
      auth(acme.tenantId),
    );
    const doc = await controller.document(invoiceId, auth(acme.tenantId));
    expect(doc.issuer.bankAccountNumber).toBe("042 118 774");
    expect(doc.issuer.legalName).toBe("Acme Forwarding (Pty) Ltd");
  });

  it("hides another company's invoice behind a 404", async () => {
    await expect(controller.document(invoiceId, auth(rival.tenantId))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("withholds cost from a non-commercial read", async () => {
    // Not hidden in the view — never sent. The portal renders whatever the API
    // returns, so the guarantee has to live at the source.
    const operatorView = await assembly.document(acme.tenantId, invoiceId, { commercial: true });
    const customerView = await assembly.document(acme.tenantId, invoiceId, { commercial: false });
    expect(operatorView.sections[0]!.lines[0]!.buyCents).not.toBeNull();
    expect(customerView.sections[0]!.lines[0]!.buyCents).toBeNull();
    expect(customerView.margin.buyCents).toBe(0);
  });
});

describe("the audit", () => {
  let invoiceId: string;

  beforeAll(async () => {
    const [shipment] = await createShipments(db, acme, [{ origin: "CNSHA", destination: "ZADUR" }]);
    await controller.addCharge(
      shipment!,
      line({
        chargeCode: "DOC",
        description: "Documentation fee",
        kind: "FEE",
        category: "DOCUMENTATION",
        provenance: "FORWARDER_ORIGINATED",
        basis: "PER_DOCUMENT",
        quantity: 3,
        unitSellCents: 85_000,
        buyCents: null,
      }),
      auth(acme.tenantId),
    );
    const issued = await controller.issue(shipment!, {}, auth(acme.tenantId));
    invoiceId = issued.invoices[0]!.invoiceId;
  });

  it("persists findings and does not duplicate them on a re-run", async () => {
    const first = await controller.audit(invoiceId, auth(acme.tenantId));
    expect(first.findings.length).toBeGreaterThan(0);
    const afterFirst = await controller.invoiceExceptions(invoiceId, auth(acme.tenantId));

    await controller.audit(invoiceId, auth(acme.tenantId));
    const afterSecond = await controller.invoiceExceptions(invoiceId, auth(acme.tenantId));
    expect(afterSecond.length).toBe(afterFirst.length);
  });

  it("keeps a human's decision when the audit runs again", async () => {
    const rows = await controller.invoiceExceptions(invoiceId, auth(acme.tenantId));
    const target = rows[0]!.exception;
    await controller.resolveException(
      target.id,
      { status: "DISPUTED", note: "Queried with the agent" },
      auth(acme.tenantId),
    );

    await controller.audit(invoiceId, auth(acme.tenantId));
    const after = await controller.invoiceExceptions(invoiceId, auth(acme.tenantId));
    expect(after.find((r) => r.exception.id === target.id)!.exception.status).toBe("DISPUTED");
  });

  it("holds a queried line back from the balance on the document", async () => {
    const doc = await controller.document(invoiceId, auth(acme.tenantId));
    expect(doc.totals.disputedCents).toBeGreaterThan(0);
    // Flagged, not netted off. Removing it would quietly reissue the invoice.
    expect(doc.totals.totalCents).toBeGreaterThanOrEqual(doc.totals.disputedCents);
  });

  it("says which of the four sources it could actually use", async () => {
    const result = await controller.audit(invoiceId, auth(acme.tenantId));
    expect(result.summary.matchedSources).toBeLessThanOrEqual(4);
    // No fuel index and no terminal feed are configured in the test
    // environment, so the vendor-cost and event sources are honestly reported
    // rather than assumed.
    expect(typeof result.summary.matchDepth.SERVICE_EVENTS).toBe("boolean");
  });

  it("never returns another tenant's exceptions", async () => {
    const mine = await controller.allExceptions(auth(rival.tenantId));
    expect(mine.every((r) => r.exception.tenantId === rival.tenantId)).toBe(true);
  });

  it("refuses to resolve an exception belonging to another tenant", async () => {
    const rows = await controller.invoiceExceptions(invoiceId, auth(acme.tenantId));
    await expect(
      controller.resolveException(
        rows[0]!.exception.id,
        { status: "ACCEPTED", note: null },
        auth(rival.tenantId),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("builds a dispute packet from the open findings", async () => {
    const packet = await controller.disputePacket(invoiceId, auth(acme.tenantId));
    expect(packet.body).toContain("before payment");
    expect(packet.subject).toContain("ZAR");
  });
});

describe("charge code normalisation", () => {
  it("resolves a tenant's own vendor dialect onto the canonical code", async () => {
    await controller.addAlias(
      { alias: "handling", canonicalCode: "OHC" },
      auth(acme.tenantId),
    );
    const rows = await controller.aliases(auth(acme.tenantId));
    expect(rows.find((r) => r.alias === "HANDLING")!.canonicalCode).toBe("OHC");

    // And it stays this tenant's: the next company's vendors speak differently.
    const theirs = await controller.aliases(auth(rival.tenantId));
    expect(theirs).toHaveLength(0);
  });

  it("treats re-mapping an alias as a correction, not a conflict", async () => {
    await controller.addAlias({ alias: "handling", canonicalCode: "THC" }, auth(acme.tenantId));
    const rows = await controller.aliases(auth(acme.tenantId));
    expect(rows.filter((r) => r.alias === "HANDLING")).toHaveLength(1);
    expect(rows.find((r) => r.alias === "HANDLING")!.canonicalCode).toBe("THC");
  });
});
