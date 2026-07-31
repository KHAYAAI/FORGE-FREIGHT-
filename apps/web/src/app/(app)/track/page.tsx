import Link from "next/link";
import { api, fmtDate } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { ShipmentStatusTag } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { CorridorMap, type CorridorLane } from "@/components/ui/corridor-map";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The shipper's view of its own cargo. Reads `/portal/*`, which scopes by the
 * parties a forwarder has linked to this customer — not by tenant, because the
 * cargo belongs to the forwarder's tenant.
 */
export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  let error: string | null = null;
  const page = await api.portalShipments({ cursor, limit: PAGE_SIZE }).catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return null;
  });

  const shipments = page?.rows ?? [];
  const lanes: CorridorLane[] = [];
  const seen = new Map<string, number>();
  for (const s of shipments) {
    if (s.status === "DELIVERED" || s.status === "CANCELLED") continue;
    const key = `${s.origin}|${s.destination}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, value] of seen) {
    const [origin, destination] = key.split("|");
    lanes.push({ origin: origin!, destination: destination!, value });
  }

  return (
    <div>
      <PageHeader
        eyebrow="Your cargo"
        title="My Shipments"
        description="Every consignment your forwarder is moving for you, and where each one has got to."
      />

      {error && <ErrorState message={error} />}

      {lanes.length > 0 && (
        <Panel className="mb-4">
          <PanelHeader title="In motion" eyebrow="Freight on the water and on the road" />
          <CorridorMap
            lanes={lanes}
            aspect={2.9}
            emptyLabel="Nothing in transit right now."
          />
        </Panel>
      )}

      <Panel>
        {shipments.length === 0 && !error ? (
          <EmptyState
            title="No shipments yet"
            description="Once your forwarder books freight for you, it appears here."
          />
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
                      <Link
                        href={`/track/${s.id}`}
                        className="font-medium text-accent hover:underline"
                      >
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

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3 text-[11.5px]">
              <span className="tabular text-tertiary">
                Showing {shipments.length} of {page?.total ?? shipments.length} shipment
                {(page?.total ?? shipments.length) === 1 ? "" : "s"}
              </span>
              <span className="flex items-center gap-3">
                {cursor && (
                  <Link href="/track" className="font-medium text-accent hover:underline">
                    ← First page
                  </Link>
                )}
                {page?.nextCursor ? (
                  <Link
                    href={`/track?cursor=${encodeURIComponent(page.nextCursor)}`}
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
