import Link from "next/link";
import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { ShipmentStatusTag } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  let error: string | null = null;
  const shipments = await api.listShipments(status).catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return [];
  });

  const statuses = [
    "BOOKED",
    "IN_TRANSIT",
    "AT_DESTINATION_PORT",
    "CUSTOMS",
    "ON_DELIVERY",
    "DELIVERED",
    "CANCELLED",
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Commercial"
        title="Shipments"
        description="Every shipment in the book — where it is, and what state it's in."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link
          href="/shipments"
          className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium ${
            !status
              ? "border-accent-border bg-accent-wash text-accent-strong"
              : "border-hairline text-secondary hover:bg-hover"
          }`}
        >
          All
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/shipments?status=${s}`}
            className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium ${
              status === s
                ? "border-accent-border bg-accent-wash text-accent-strong"
                : "border-hairline text-secondary hover:bg-hover"
            }`}
          >
            {s.replaceAll("_", " ")}
          </Link>
        ))}
      </div>

      {error && <ErrorState message={error} />}

      <Panel>
        {shipments.length === 0 && !error ? (
          <EmptyState title="No shipments" description="Nothing matches this filter." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Route</TH>
                <TH>Status</TH>
                <TH>Booked</TH>
              </TR>
            </THead>
            <tbody>
              {shipments.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <Link href={`/shipments/${s.id}`} className="font-medium text-accent hover:underline">
                      <Mono>{s.reference}</Mono>
                    </Link>
                  </TD>
                  <TD className="text-secondary">
                    <Mono className="text-primary">{s.origin}</Mono> →{" "}
                    <Mono className="text-primary">{s.destination}</Mono>
                  </TD>
                  <TD>
                    <ShipmentStatusTag status={s.status} />
                  </TD>
                  <TD className="text-secondary">{fmtDate(s.createdAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
