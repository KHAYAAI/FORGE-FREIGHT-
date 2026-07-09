import { createDb } from "./client.js";
import {
  marginRules,
  parties,
  rateCards,
  rateSurcharges,
  tenants,
} from "./schema.js";

/**
 * Dev seed: the operator tenant, one demo customer, and rate cards for the
 * three launch lanes — CNSHA→ZADUR ocean, ZADUR→ZAJNB road (Durban–Joburg
 * corridor), DEHAM→ZADUR ocean. Amounts are integer cents.
 *
 * Idempotent enough for dev: truncates rate tables first.
 */
async function main() {
  const db = createDb();

  const [operator] = await db
    .insert(tenants)
    .values({ type: "OPERATOR", name: "FORGE Freight" })
    .returning();
  if (!operator) throw new Error("failed to create operator tenant");

  const [customer] = await db
    .insert(parties)
    .values({
      tenantId: operator.id,
      name: "Ubuntu Trading (Pty) Ltd",
      country: "ZA",
      address: "12 Marine Drive, Durban",
      email: "ops@ubuntutrading.example",
    })
    .returning();
  if (!customer) throw new Error("failed to create demo customer");

  const [maersk] = await db
    .insert(parties)
    .values({ tenantId: operator.id, name: "Maersk Line", country: "DK" })
    .returning();
  const [trucker] = await db
    .insert(parties)
    .values({ tenantId: operator.id, name: "N3 Corridor Logistics", country: "ZA" })
    .returning();
  if (!maersk || !trucker) throw new Error("failed to create carrier parties");

  const validFrom = new Date("2026-07-01T00:00:00Z");
  const validTo = new Date("2026-09-30T23:59:59Z");

  const [shaDur] = await db
    .insert(rateCards)
    .values({
      tenantId: operator.id,
      kind: "CONTRACT",
      carrierId: maersk.id,
      carrierName: "Maersk Line",
      mode: "OCEAN",
      origin: "CNSHA",
      destination: "ZADUR",
      containerType: "40HC",
      buyAmountCents: 2350_00, // USD 2,350.00 per 40HC
      currency: "USD",
      transitDays: 28,
      validFrom,
      validTo,
    })
    .returning();

  const [hamDur] = await db
    .insert(rateCards)
    .values({
      tenantId: operator.id,
      kind: "CONTRACT",
      carrierId: maersk.id,
      carrierName: "Maersk Line",
      mode: "OCEAN",
      origin: "DEHAM",
      destination: "ZADUR",
      containerType: "40HC",
      buyAmountCents: 1980_00, // USD 1,980.00 per 40HC
      currency: "USD",
      transitDays: 24,
      validFrom,
      validTo,
    })
    .returning();

  const [durJnb] = await db
    .insert(rateCards)
    .values({
      tenantId: operator.id,
      kind: "CONTRACT",
      carrierId: trucker.id,
      carrierName: "N3 Corridor Logistics",
      mode: "ROAD",
      origin: "ZADUR",
      destination: "ZAJNB",
      containerType: "40HC",
      buyAmountCents: 18500_00, // ZAR 18,500.00 per container Durban→Joburg
      currency: "ZAR",
      transitDays: 2,
      validFrom,
      validTo,
    })
    .returning();
  if (!shaDur || !hamDur || !durJnb) throw new Error("failed to create rate cards");

  await db.insert(rateSurcharges).values([
    {
      rateCardId: shaDur.id,
      code: "BAF",
      description: "Bunker adjustment factor",
      basis: "PER_CONTAINER",
      amountCents: 210_00,
      currency: "USD",
    },
    {
      rateCardId: shaDur.id,
      code: "THC-D",
      description: "Terminal handling, Durban",
      basis: "PER_CONTAINER",
      amountCents: 4350_00,
      currency: "ZAR",
    },
    {
      rateCardId: shaDur.id,
      code: "DOC",
      description: "Documentation fee",
      basis: "PER_BL",
      amountCents: 950_00,
      currency: "ZAR",
    },
    {
      rateCardId: hamDur.id,
      code: "BAF",
      description: "Bunker adjustment factor",
      basis: "PER_CONTAINER",
      amountCents: 185_00,
      currency: "USD",
    },
    {
      rateCardId: durJnb.id,
      code: "TOLL",
      description: "N3 toll recovery",
      basis: "PER_CONTAINER",
      amountCents: 1240_00,
      currency: "ZAR",
    },
  ]);

  await db.insert(marginRules).values([
    // Default operator margin: 18% with ZAR 1,500 floor per line.
    {
      tenantId: operator.id,
      marginBps: 1800,
      minMarginCents: 1500_00,
    },
    // Sharper margin on the flagship CNSHA→ZADUR lane to win volume.
    {
      tenantId: operator.id,
      origin: "CNSHA",
      destination: "ZADUR",
      mode: "OCEAN",
      marginBps: 1200,
      minMarginCents: 1000_00,
    },
  ]);

  console.log("Seeded:", {
    operator: operator.id,
    customer: customer.id,
    lanes: ["CNSHA→ZADUR 40HC (USD)", "DEHAM→ZADUR 40HC (USD)", "ZADUR→ZAJNB road (ZAR)"],
  });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
