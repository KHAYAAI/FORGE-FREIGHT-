import Link from "next/link";
import { apiGet } from "@/lib/api";

interface OpsException {
  exceptionId: string;
  code: string;
  detail: string | null;
  raisedAt: string;
  shipmentId: string;
  reference: string;
  status: string;
  origin: string;
  destination: string;
}

const CODE_LABELS: Record<string, string> = {
  BOOKING_ROLLED: "Rolled booking",
  CUSTOMS_STOP: "Customs stop",
  CUSTOMS_QUERY: "Customs query",
  CONGESTION_DELAY: "Congestion delay",
  COMPLIANCE_HOLD: "Compliance hold",
};

export const dynamic = "force-dynamic";

/** Ops kanban: default view = what needs a human today. */
export default async function OpsPage() {
  let exceptions: OpsException[] = [];
  let error: string | null = null;
  try {
    exceptions = await apiGet<OpsException[]>("/ops/exceptions");
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const byCode = new Map<string, OpsException[]>();
  for (const ex of exceptions) {
    byCode.set(ex.code, [...(byCode.get(ex.code) ?? []), ex]);
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Ops — what needs a human today</h1>
      {error && <p style={{ color: "#dc2626" }}>API unavailable: {error}</p>}
      {exceptions.length === 0 && !error && (
        <p style={{ color: "#16a34a" }}>No open exceptions. Enjoy it while it lasts.</p>
      )}
      <div style={{ display: "flex", gap: "1rem", overflowX: "auto" }}>
        {[...byCode.entries()].map(([code, items]) => (
          <section key={code} style={{ minWidth: 260, flex: 1 }}>
            <h2 style={{ fontSize: "1rem", borderBottom: "2px solid #d97706" }}>
              {CODE_LABELS[code] ?? code} ({items.length})
            </h2>
            {items.map((ex) => (
              <Link
                key={ex.exceptionId}
                href={`/shipments/${ex.shipmentId}`}
                style={{
                  display: "block",
                  padding: "0.75rem",
                  marginBottom: "0.5rem",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <strong>{ex.reference}</strong>
                <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                  {ex.origin} → {ex.destination}
                </div>
                {ex.detail && (
                  <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>{ex.detail}</div>
                )}
                <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                  raised {new Date(ex.raisedAt).toLocaleString("en-ZA")}
                </div>
              </Link>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
