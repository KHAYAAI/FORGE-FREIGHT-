import Link from "next/link";

const card = {
  display: "block",
  padding: "1.25rem",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  textDecoration: "none",
  color: "inherit",
} as const;

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1>FORGE Freight</h1>
      <p>
        Digital freight forwarding for African trade corridors — instant
        quotes, real container visibility, AI-prepared customs entries, and
        trade finance built into the same ledger that runs your payments.
      </p>
      <div style={{ display: "grid", gap: "1rem", marginTop: "2rem" }}>
        <Link href="/quotes/new" style={card}>
          <strong>Instant quote</strong>
          <div>Itemised multicurrency quote in seconds; book in one click.</div>
        </Link>
        <Link href="/shipments" style={card}>
          <strong>Shipments</strong>
          <div>Where is my stuff — live event timeline per shipment.</div>
        </Link>
        <Link href="/ops" style={card}>
          <strong>Ops console</strong>
          <div>What needs a human today — open exceptions kanban.</div>
        </Link>
      </div>
    </main>
  );
}
