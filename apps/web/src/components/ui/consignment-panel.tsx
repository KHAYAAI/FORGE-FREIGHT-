import { Panel, PanelHeader } from "@/components/ui/card";
import { Table, THead, TR, TH, TD, Mono } from "@/components/ui/table";
import { Tag, type Tone } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";
import type { Consignment } from "@/lib/types";

const PACKAGE_LABEL: Record<string, string> = {
  PALLET: "Pallets",
  CARTON: "Cartons",
  CRATE: "Crates",
  DRUM: "Drums",
  BAG: "Bags",
  BALE: "Bales",
  ROLL: "Rolls",
  IBC: "IBC totes",
  BULK: "Bulk",
  LOOSE: "Loose",
};

const CARGO_TONE: Record<string, Tone> = {
  GENERAL: "neutral",
  HAZARDOUS: "critical",
  REEFER: "accent",
  PERISHABLE: "warning",
  OVERSIZED: "warning",
  VALUABLE: "warning",
  LIVE_ANIMALS: "warning",
};

const URGENCY_TONE: Record<string, Tone> = {
  ECONOMY: "neutral",
  STANDARD: "neutral",
  EXPRESS: "accent",
  CRITICAL: "warning",
};

const kg = (g: number) => (g / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 });
const m3 = (cm3: number) => (cm3 / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const cm = (mm: number | null) => (mm == null ? null : mm / 10);
const title = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/**
 * The consignment, as an operator or a shipper sees it.
 *
 * `commercial` adds the figures that only mean something to the forwarder —
 * currently the handling requirements, which reference carrier and terminal
 * obligations a customer has no action on. The cargo itself is the customer's
 * own declaration coming back to them, so none of that is hidden.
 */
export function ConsignmentPanel({
  consignment,
  commercial = false,
}: {
  consignment: Consignment;
  commercial?: boolean;
}) {
  const c = consignment;
  const blocking = c.requirements.filter((r) => r.blocking);

  return (
    <Panel>
      <PanelHeader
        title="Cargo"
        eyebrow="What is being shipped"
        actions={
          <span className="flex flex-wrap gap-1.5">
            <Tag tone={CARGO_TONE[c.cargoType] ?? "neutral"} dot>
              {title(c.cargoType)}
            </Tag>
            <Tag tone={URGENCY_TONE[c.urgency] ?? "neutral"}>{title(c.urgency)}</Tag>
          </span>
        }
      />

      <p className="mb-3 text-[13px] text-primary">{c.description}</p>

      {commercial && blocking.length > 0 && (
        <div className="mb-3 rounded border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-critical-wash px-3 py-2">
          {blocking.map((r) => (
            <div key={r.code} className="text-[12px] text-critical">
              {r.description}
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Pieces" value={String(c.pieces)} />
        <Figure label="Gross weight" value={`${kg(c.grossWeightGrams)} kg`} />
        <Figure label="Volume" value={`${m3(c.volumeCm3)} m³`} />
        <Figure
          label="Chargeable"
          value={`${kg(c.chargeableWeightGrams)} kg`}
          accent
          note={c.volumetricApplies ? "billed on volume" : "billed on weight"}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <Row label="Port of exit" value={<Mono className="text-primary">{c.portOfExit}</Mono>} />
        <Row label="Port of entry" value={<Mono className="text-primary">{c.portOfEntry}</Mono>} />
        <Row
          label="Pick-up point"
          value={
            c.pickupLocode ? (
              <Mono className="text-primary">{c.pickupLocode}</Mono>
            ) : (
              <span className="text-tertiary">Delivered to port by shipper</span>
            )
          }
        />
        {c.pickupAddress && <Row label="Collection address" value={c.pickupAddress} />}
        {c.pickupContact && <Row label="Site contact" value={c.pickupContact} />}
        {(c.pickupFrom || c.pickupTo) && (
          <Row
            label="Collection window"
            value={`${fmtDate(c.pickupFrom)} — ${fmtDate(c.pickupTo)}`}
          />
        )}
        {c.unNumber && (
          <Row
            label="Dangerous goods"
            value={
              <Mono className="text-primary">
                {c.unNumber} · class {c.imoClass} · PG {c.packingGroup}
              </Mono>
            }
          />
        )}
        {c.tempMinDeciC != null && c.tempMaxDeciC != null && (
          <Row
            label="Temperature"
            value={`${(c.tempMinDeciC / 10).toFixed(1)} °C to ${(c.tempMaxDeciC / 10).toFixed(1)} °C`}
          />
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Contents</TH>
              <TH>Packaging</TH>
              <TH align="right">Pieces</TH>
              <TH align="right">Weight</TH>
              <TH>Per piece</TH>
              <TH>Marks</TH>
            </TR>
          </THead>
          <tbody>
            {c.items.map((item) => (
              <TR key={item.id}>
                <TD className="text-primary">{item.description}</TD>
                <TD className="text-secondary">
                  {PACKAGE_LABEL[item.packageType] ?? item.packageType}
                  {!item.stackable && (
                    <Tag tone="warning" className="ml-1.5">
                      No stack
                    </Tag>
                  )}
                </TD>
                <TD align="right" className="tabular">
                  {item.pieces}
                </TD>
                <TD align="right" className="tabular text-primary">
                  {kg(item.grossWeightGrams)} kg
                </TD>
                <TD className="text-secondary">
                  {item.lengthMm && item.widthMm && item.heightMm
                    ? `${cm(item.lengthMm)} × ${cm(item.widthMm)} × ${cm(item.heightMm)} cm`
                    : "—"}
                </TD>
                <TD className="text-secondary">
                  {item.marksAndNumbers ? <Mono>{item.marksAndNumbers}</Mono> : "—"}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </div>

      {commercial && c.requirements.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-hairline pt-3">
          {c.requirements.map((r) => (
            <div key={r.code} className="flex items-start gap-2">
              <Tag tone={r.blocking ? "critical" : "warning"} dot>
                {r.blocking ? "Required" : "Note"}
              </Tag>
              <span className="text-[11.5px] text-secondary">{r.description}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Figure({
  label,
  value,
  accent,
  note,
}: {
  label: string;
  value: string;
  accent?: boolean;
  note?: string;
}) {
  return (
    <div className="rounded border border-hairline bg-inset p-3">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-tertiary">{label}</div>
      <div
        className={`tabular mt-1 text-[17px] font-semibold ${accent ? "text-accent-strong" : "text-primary"}`}
      >
        {value}
      </div>
      {note && <div className="mt-0.5 text-[10.5px] text-tertiary">{note}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dotted border-hairline py-1.5 text-[12.5px]">
      <span className="text-secondary">{label}</span>
      <span className="text-right text-primary">{value}</span>
    </div>
  );
}
