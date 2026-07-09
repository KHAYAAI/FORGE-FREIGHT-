import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import {
  customsEntries,
  customsEntryLines,
  shipments,
  type Db,
} from "@forge-freight/db";
import {
  EntryPrepared,
  EntryQueried,
  EntryReleased,
  EntryStopped,
  EntrySubmitted,
  makeEvent,
  type EventActor,
} from "@forge-freight/events";
import { DB } from "../db/db.module.js";
import { appendEvent } from "../db/event-store.js";
import {
  CLASSIFICATION_CONFIRM_THRESHOLD,
  ClassificationService,
} from "./classification.service.js";
import {
  assertTransition,
  computeDutyLine,
  computeEntryTotals,
  InvalidEntryTransitionError,
  type EntryStatus,
} from "./duty-calculator.js";

export interface EntryLineInput {
  description: string;
  customsValueCents: number;
  /** Explicit HS code, or null to auto-classify from the description. */
  hsCode?: string;
  dutyRateBps?: number;
  sacuOrigin?: boolean;
}

@Injectable()
export class CustomsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ClassificationService) private readonly classification: ClassificationService,
  ) {}

  /** Create a DRAFT entry with classified, duty-computed lines. */
  async createEntry(params: {
    shipmentId: string;
    tenantId: string;
    lines: EntryLineInput[];
    actor: EventActor;
  }) {
    const [shipment] = await this.db
      .select()
      .from(shipments)
      .where(
        and(
          eq(shipments.id, params.shipmentId),
          eq(shipments.tenantId, params.tenantId),
        ),
      );
    if (!shipment) throw new NotFoundException("Shipment not found");

    const preparedLines = params.lines.map((line) => {
      let hsCode = line.hsCode ?? null;
      let dutyRateBps = line.dutyRateBps ?? null;
      let confidence: number | null = null;

      if (!hsCode || dutyRateBps == null) {
        const [candidate] = this.classification.classify(line.description);
        if (candidate) {
          hsCode ??= candidate.hsCode;
          dutyRateBps ??= candidate.generalRateBps;
          confidence = candidate.confidence;
        }
      } else {
        confidence = 1; // explicitly provided by a human
      }
      if (!hsCode || dutyRateBps == null) {
        throw new ConflictException(
          `Cannot classify "${line.description}" — provide hsCode and dutyRateBps explicitly`,
        );
      }

      const computed = computeDutyLine({
        customsValueCents: line.customsValueCents,
        dutyRateBps,
        sacuOrigin: line.sacuOrigin,
      });
      return {
        description: line.description,
        hsCode,
        confidence,
        humanConfirmed: confidence != null && confidence >= 1,
        ...computed,
      };
    });

    const [entry] = await this.db
      .insert(customsEntries)
      .values({
        tenantId: params.tenantId,
        shipmentId: params.shipmentId,
        status: "DRAFT",
        ...computeEntryTotals(preparedLines),
        currency: "ZAR",
      })
      .returning();

    await this.db.insert(customsEntryLines).values(
      preparedLines.map((line) => ({
        customsEntryId: entry!.id,
        hsCode: line.hsCode,
        description: line.description,
        customsValueCents: line.customsValueCents,
        dutyCents: line.dutyCents,
        vatCents: line.vatCents,
        currency: "ZAR",
        classificationConfidence: line.confidence,
        humanConfirmed: line.humanConfirmed,
      })),
    );

    return this.getEntry(entry!.id, params.tenantId);
  }

  async getEntry(entryId: string, tenantId: string) {
    const [entry] = await this.db
      .select()
      .from(customsEntries)
      .where(
        and(eq(customsEntries.id, entryId), eq(customsEntries.tenantId, tenantId)),
      );
    if (!entry) throw new NotFoundException("Customs entry not found");
    const lines = await this.db
      .select()
      .from(customsEntryLines)
      .where(eq(customsEntryLines.customsEntryId, entryId));
    return { ...entry, lines };
  }

  /** Human confirms a low-confidence classification (or corrects the code). */
  async confirmLine(params: {
    entryId: string;
    lineId: string;
    tenantId: string;
    hsCode?: string;
  }) {
    const entry = await this.getEntry(params.entryId, params.tenantId);
    if (entry.status !== "DRAFT") {
      throw new ConflictException("Lines can only be confirmed on DRAFT entries");
    }
    await this.db
      .update(customsEntryLines)
      .set({
        humanConfirmed: true,
        ...(params.hsCode ? { hsCode: params.hsCode } : {}),
      })
      .where(eq(customsEntryLines.id, params.lineId));
    return this.getEntry(params.entryId, params.tenantId);
  }

  /**
   * DRAFT → PREPARED. Blocks while any line's classification confidence is
   * below threshold without human confirmation — the non-negotiable.
   */
  async prepare(entryId: string, tenantId: string, actor: EventActor) {
    const entry = await this.getEntry(entryId, tenantId);
    this.transition(entry.status, "PREPARED");

    const unconfirmed = entry.lines.filter(
      (l) =>
        !l.humanConfirmed &&
        (l.classificationConfidence ?? 0) < CLASSIFICATION_CONFIRM_THRESHOLD,
    );
    if (unconfirmed.length > 0) {
      throw new ConflictException(
        `${unconfirmed.length} line(s) below classification confidence ${CLASSIFICATION_CONFIRM_THRESHOLD} need human confirmation`,
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(customsEntries)
        .set({ status: "PREPARED" })
        .where(eq(customsEntries.id, entryId));
      await appendEvent(
        tx,
        makeEvent({
          definition: EntryPrepared,
          tenantId,
          actor,
          shipmentId: entry.shipmentId,
          payload: {
            customsEntryId: entryId,
            hsLines: entry.lines.map((l) => ({
              hsCode: l.hsCode,
              customsValue: { amountCents: l.customsValueCents, currency: l.currency },
              dutyComputed: { amountCents: l.dutyCents, currency: l.currency },
              vatComputed: { amountCents: l.vatCents, currency: l.currency },
              classificationConfidence: l.classificationConfidence ?? 1,
              humanConfirmed: l.humanConfirmed,
            })),
          },
        }),
      );
    });
    return this.getEntry(entryId, tenantId);
  }

  /** PREPARED → SUBMITTED via the accredited bureau (adapter stub records the ref). */
  async submit(entryId: string, tenantId: string, actor: EventActor) {
    const entry = await this.getEntry(entryId, tenantId);
    this.transition(entry.status, "SUBMITTED");
    const bureauRef = `BUREAU-${entryId.slice(0, 8).toUpperCase()}`;

    await this.db.transaction(async (tx) => {
      await tx
        .update(customsEntries)
        .set({ status: "SUBMITTED", bureauRef })
        .where(eq(customsEntries.id, entryId));
      await appendEvent(
        tx,
        makeEvent({
          definition: EntrySubmitted,
          tenantId,
          actor,
          shipmentId: entry.shipmentId,
          payload: { customsEntryId: entryId, bureauRef },
        }),
      );
    });
    return { entryId, status: "SUBMITTED", bureauRef };
  }

  /** Bureau/SARS outcome webhook: QUERY, RELEASED, or STOPPED. */
  async recordOutcome(params: {
    entryId: string;
    tenantId: string;
    outcome: "QUERY" | "RELEASED" | "STOPPED";
    detail?: string;
    releaseRef?: string;
    actor: EventActor;
  }) {
    const entry = await this.getEntry(params.entryId, params.tenantId);
    this.transition(entry.status, params.outcome);

    await this.db.transaction(async (tx) => {
      await tx
        .update(customsEntries)
        .set({
          status: params.outcome,
          ...(params.releaseRef ? { releaseRef: params.releaseRef } : {}),
        })
        .where(eq(customsEntries.id, params.entryId));

      const shared = {
        tenantId: params.tenantId,
        actor: params.actor,
        shipmentId: entry.shipmentId,
      };
      if (params.outcome === "QUERY") {
        await appendEvent(
          tx,
          makeEvent({
            ...shared,
            definition: EntryQueried,
            payload: {
              customsEntryId: params.entryId,
              queryText: params.detail ?? "SARS query — see bureau correspondence",
            },
          }),
        );
      } else if (params.outcome === "STOPPED") {
        await appendEvent(
          tx,
          makeEvent({
            ...shared,
            definition: EntryStopped,
            payload: { customsEntryId: params.entryId, reason: params.detail ?? null },
          }),
        );
      } else {
        await appendEvent(
          tx,
          makeEvent({
            ...shared,
            definition: EntryReleased,
            payload: {
              customsEntryId: params.entryId,
              dutiesTotal: {
                amountCents: entry.dutiesTotalCents ?? 0,
                currency: entry.currency,
              },
              vatTotal: {
                amountCents: entry.vatTotalCents ?? 0,
                currency: entry.currency,
              },
              releaseRef: params.releaseRef ?? null,
            },
          }),
        );
      }
    });
    return { entryId: params.entryId, status: params.outcome };
  }

  /**
   * Bureau-ready payload — the clean internal format the bureau adapter
   * transmits. Only PREPARED+ entries can be exported.
   */
  async bureauPayload(entryId: string, tenantId: string) {
    const entry = await this.getEntry(entryId, tenantId);
    if (entry.status === "DRAFT") {
      throw new ConflictException("Entry must be PREPARED before export");
    }
    const [shipment] = await this.db
      .select()
      .from(shipments)
      .where(eq(shipments.id, entry.shipmentId));
    return {
      format: "forge-freight/customs-entry@1",
      entryId: entry.id,
      shipmentReference: shipment?.reference,
      declaration: {
        procedure: "A11", // home use import — bureau confirms per shipment
        currency: entry.currency,
        lines: entry.lines.map((l, i) => ({
          lineNo: i + 1,
          hsCode: l.hsCode,
          description: l.description,
          customsValueCents: l.customsValueCents,
          dutyCents: l.dutyCents,
          vatCents: l.vatCents,
        })),
        dutiesTotalCents: entry.dutiesTotalCents,
        vatTotalCents: entry.vatTotalCents,
      },
    };
  }

  private transition(from: string, to: EntryStatus) {
    try {
      assertTransition(from as EntryStatus, to);
    } catch (err) {
      if (err instanceof InvalidEntryTransitionError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}
