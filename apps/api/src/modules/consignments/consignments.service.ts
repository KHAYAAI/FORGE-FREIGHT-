import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { cargoItems, consignments, type Db } from "@forge-freight/db";
import { DB } from "../db/db.module.js";
import type { CreateConsignment, UpdateConsignment } from "./consignments.dto.js";
import {
  CargoMeasurementError,
  blockingRequirements,
  computeConsignmentTotals,
  handlingRequirements,
  type TransportMode,
} from "./packing.js";

export type ConsignmentRow = typeof consignments.$inferSelect;
export type CargoItemRow = typeof cargoItems.$inferSelect;

export interface ConsignmentView extends ConsignmentRow {
  items: CargoItemRow[];
  requirements: ReturnType<typeof handlingRequirements>;
  volumetricWeightGrams: number;
  volumetricApplies: boolean;
}

@Injectable()
export class ConsignmentsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Create a consignment and its packing list in one transaction, rolling the
   * items up into the totals a rate is applied to.
   *
   * The totals are stored rather than derived on read. A quote has to stay
   * reproducible: if someone corrects a weight next week, the price the
   * customer accepted must still be explicable from the numbers it was
   * actually computed on.
   */
  async create(tenantId: string, dto: CreateConsignment, mode: TransportMode) {
    let totals;
    try {
      totals = computeConsignmentTotals(dto.items, mode);
    } catch (err) {
      if (err instanceof CargoMeasurementError) {
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    }

    // Cargo that cannot legally or physically move is refused here, at the
    // cheapest possible moment, rather than at a terminal gate.
    const blocking = blockingRequirements(dto);
    if (blocking.length > 0) {
      throw new UnprocessableEntityException(blocking.map((r) => r.description).join(" "));
    }

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(consignments)
        .values({
          tenantId,
          description: dto.description,
          cargoType: dto.cargoType,
          urgency: dto.urgency,
          pickupLocode: dto.pickupLocode ?? null,
          pickupAddress: dto.pickupAddress ?? null,
          pickupContact: dto.pickupContact ?? null,
          pickupFrom: dto.pickupFrom ?? null,
          pickupTo: dto.pickupTo ?? null,
          portOfExit: dto.portOfExit,
          portOfEntry: dto.portOfEntry,
          pieces: totals.pieces,
          grossWeightGrams: totals.grossWeightGrams,
          volumeCm3: totals.volumeCm3,
          chargeableWeightGrams: totals.chargeableWeightGrams,
          unNumber: dto.unNumber ?? null,
          imoClass: dto.imoClass ?? null,
          packingGroup: dto.packingGroup ?? null,
          tempMinDeciC: dto.tempMinDeciC ?? null,
          tempMaxDeciC: dto.tempMaxDeciC ?? null,
        })
        .returning();

      const items = await tx
        .insert(cargoItems)
        .values(
          dto.items.map((i) => ({
            consignmentId: row!.id,
            description: i.description,
            packageType: i.packageType,
            pieces: i.pieces,
            grossWeightGrams: i.grossWeightGrams,
            lengthMm: i.lengthMm ?? null,
            widthMm: i.widthMm ?? null,
            heightMm: i.heightMm ?? null,
            stackable: i.stackable,
            marksAndNumbers: i.marksAndNumbers ?? null,
            hsCode: i.hsCode ?? null,
          })),
        )
        .returning();

      return this.view(row!, items, totals);
    });
  }

  /** A consignment with its packing list, scoped to the caller's tenant. */
  async get(tenantId: string, id: string): Promise<ConsignmentView> {
    const [row] = await this.db
      .select()
      .from(consignments)
      .where(and(eq(consignments.id, id), eq(consignments.tenantId, tenantId)));
    if (!row) throw new NotFoundException(`Consignment ${id} not found`);
    const items = await this.itemsFor([row.id]);
    return this.view(row, items.get(row.id) ?? []);
  }

  /** Consignments a tenant has raised, newest first. */
  async list(tenantId: string, limit = 100) {
    const rows = await this.db
      .select()
      .from(consignments)
      .where(eq(consignments.tenantId, tenantId))
      .orderBy(desc(consignments.createdAt))
      .limit(limit);
    if (rows.length === 0) return [];
    const items = await this.itemsFor(rows.map((r) => r.id));
    return rows.map((r) => this.view(r, items.get(r.id) ?? []));
  }

  /**
   * Correct a consignment's descriptive fields.
   *
   * The packing list is not editable here on purpose: changing an item would
   * change the chargeable weight, and therefore the price of a quote that may
   * already have been issued or accepted. Re-quoting is the honest path, and
   * it leaves both figures on the record.
   */
  async update(tenantId: string, id: string, dto: UpdateConsignment) {
    const existing = await this.get(tenantId, id);
    // A partial update leaves undefined where a field was not sent; the merged
    // view has to fall back to the stored row, not to undefined, or a DG
    // consignment could be edited into passing the compliance check.
    const merged = {
      cargoType: dto.cargoType ?? existing.cargoType,
      unNumber: dto.unNumber !== undefined ? dto.unNumber : existing.unNumber,
      imoClass: dto.imoClass !== undefined ? dto.imoClass : existing.imoClass,
      packingGroup: dto.packingGroup !== undefined ? dto.packingGroup : existing.packingGroup,
      tempMinDeciC: dto.tempMinDeciC !== undefined ? dto.tempMinDeciC : existing.tempMinDeciC,
      tempMaxDeciC: dto.tempMaxDeciC !== undefined ? dto.tempMaxDeciC : existing.tempMaxDeciC,
      portOfExit: dto.portOfExit ?? existing.portOfExit,
      portOfEntry: dto.portOfEntry ?? existing.portOfEntry,
    };

    const blocking = blockingRequirements(merged);
    if (blocking.length > 0) {
      throw new UnprocessableEntityException(blocking.map((r) => r.description).join(" "));
    }
    if (merged.portOfExit === merged.portOfEntry) {
      throw new UnprocessableEntityException("The port of exit and the port of entry must differ");
    }

    const [row] = await this.db
      .update(consignments)
      .set({
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.cargoType !== undefined && { cargoType: dto.cargoType }),
        ...(dto.urgency !== undefined && { urgency: dto.urgency }),
        ...(dto.pickupLocode !== undefined && { pickupLocode: dto.pickupLocode ?? null }),
        ...(dto.pickupAddress !== undefined && { pickupAddress: dto.pickupAddress ?? null }),
        ...(dto.pickupContact !== undefined && { pickupContact: dto.pickupContact ?? null }),
        ...(dto.pickupFrom !== undefined && { pickupFrom: dto.pickupFrom ?? null }),
        ...(dto.pickupTo !== undefined && { pickupTo: dto.pickupTo ?? null }),
        ...(dto.portOfExit !== undefined && { portOfExit: dto.portOfExit }),
        ...(dto.portOfEntry !== undefined && { portOfEntry: dto.portOfEntry }),
        ...(dto.unNumber !== undefined && { unNumber: dto.unNumber ?? null }),
        ...(dto.imoClass !== undefined && { imoClass: dto.imoClass ?? null }),
        ...(dto.packingGroup !== undefined && { packingGroup: dto.packingGroup ?? null }),
        ...(dto.tempMinDeciC !== undefined && { tempMinDeciC: dto.tempMinDeciC ?? null }),
        ...(dto.tempMaxDeciC !== undefined && { tempMaxDeciC: dto.tempMaxDeciC ?? null }),
      })
      .where(and(eq(consignments.id, id), eq(consignments.tenantId, tenantId)))
      .returning();
    return this.view(row!, existing.items);
  }

  // --- internals ------------------------------------------------------------

  private async itemsFor(ids: string[]): Promise<Map<string, CargoItemRow[]>> {
    const rows = await this.db
      .select()
      .from(cargoItems)
      .where(inArray(cargoItems.consignmentId, ids))
      .orderBy(asc(cargoItems.description));
    const out = new Map<string, CargoItemRow[]>();
    for (const r of rows) {
      const list = out.get(r.consignmentId) ?? [];
      list.push(r);
      out.set(r.consignmentId, list);
    }
    return out;
  }

  /**
   * Stored totals plus the two derived figures a screen wants: how the
   * volumetric weight compares, and what still has to be resolved before this
   * can move.
   */
  private view(
    row: ConsignmentRow,
    items: CargoItemRow[],
    totals?: { volumetricWeightGrams: number; volumetricApplies: boolean },
  ): ConsignmentView {
    const volumetricWeightGrams =
      totals?.volumetricWeightGrams ??
      // Recomputed from the stored volume rather than the items, so it agrees
      // with the chargeable weight the quote was actually priced on.
      Math.max(0, row.chargeableWeightGrams > row.grossWeightGrams ? row.chargeableWeightGrams : 0);
    return {
      ...row,
      items,
      requirements: handlingRequirements(row),
      volumetricWeightGrams,
      volumetricApplies:
        totals?.volumetricApplies ?? row.chargeableWeightGrams > row.grossWeightGrams,
    };
  }
}
