import Link from "next/link";
import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { ShipmentStatusTag } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const STATUSES = [
  "BOOKED",
  "IN_TRANSIT",
  "AT_DESTINATION_PORT",
  "CUSTOMS",
  "ON_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { status, cursor } = await searchParams;
  let error: string | null = null;
  const page = await api
    .listShipments({ status, cursor, limit: PAGE_SIZE })
    .catch((e) => {
      error = e instanceof Error ? e.message : String(e);
      return null;
    });

  const shipments = page?.rows ?? [];
  const filterQuery = status ? `status=${status}` : "";

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
        {STATUSES.map((s) => (
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
          <>
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

            {/*
              Always state the total, even on a single page. The point of
              paginating was that a short list used to be indistinguishable
              from the whole book.
            */}
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3 text-[11.5px]">
              <span className="tabular text-tertiary">
                Showing {shipments.length} of {page?.total ?? shipments.length}
                {status ? ` ${status.replaceAll("_", " ").toLowerCase()}` : ""} shipment
                {(page?.total ?? shipments.length) === 1 ? "" : "s"}
              </span>
              <span className="flex items-center gap-3">
                {cursor && (
                  <Link
                    href={`/shipments${filterQuery ? `?${filterQuery}` : ""}`}
                    className="font-medium text-accent hover:underline"
                  >
                    ← First page
                  </Link>
                )}
                {page?.nextCursor ? (
                  <Link
                    href={`/shipments?${filterQuery ? `${filterQuery}&` : ""}cursor=${encodeURIComponent(page.nextCursor)}`}
                    className="font-medium text-accent hover:underline"
                  >
                    Next page →
                  </Link>
                ) : (
                  <span className="text-tertiary">End of list</span>
                )}
              </span>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
