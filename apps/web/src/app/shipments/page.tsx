import Link from "next/link";
import { apiGet } from "@/lib/api";

interface Shipment {
  id: string;
  reference: string;
  status: string;
  origin: string;
  destination: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  BOOKED: "#6b7280",
  IN_TRANSIT: "#2563eb",
  AT_DESTINATION_PORT: "#7c3aed",
  CUSTOMS: "#d97706",
  ON_DELIVERY: "#0891b2",
  DELIVERED: "#16a34a",
  CANCELLED: "#dc2626",
};

export const dynamic = "force-dynamic";

export default async function ShipmentsPage() {
  let shipments: Shipment[] = [];
  let error: string | null = null;
  try {
    shipments = await apiGet<Shipment[]>("/shipments");
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Shipments</h1>
      {error && <p style={{ color: "#dc2626" }}>API unavailable: {error}</p>}
      {shipments.length === 0 && !error && <p>No shipments yet.</p>}
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {shipments.map((s) => (
          <Link
            key={s.id}
            href={`/shipments/${s.id}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "1rem",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div>
              <strong>{s.reference}</strong>
              <div style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                {s.origin} → {s.destination}
              </div>
            </div>
            <span
              style={{
                background: STATUS_COLORS[s.status] ?? "#6b7280",
                color: "white",
                borderRadius: 999,
                padding: "0.25rem 0.75rem",
                fontSize: "0.8rem",
              }}
            >
              {s.status.replaceAll("_", " ")}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
