import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { documents, type Db } from "@forge-freight/db";
import {
  DocumentApproved,
  DocumentExtracted,
  DocumentUploaded,
  makeEvent,
  type EventActor,
} from "@forge-freight/events";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";
import { appendEvent } from "../db/event-store.js";
import { isExtractable } from "./extraction-schemas.js";
import { ExtractionService } from "./extraction.service.js";
import { createDocumentStorage, type DocumentStorage } from "./storage.js";

type DocType =
  | "COMMERCIAL_INVOICE"
  | "PACKING_LIST"
  | "BL"
  | "SAD500"
  | "CERTIFICATE_OF_ORIGIN"
  | "CLEARING_INSTRUCTION"
  | "POD"
  | "OTHER";

@Injectable()
export class DocumentsService {
  private readonly storage: DocumentStorage;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(ExtractionService) private readonly extraction: ExtractionService,
  ) {
    this.storage = createDocumentStorage(cfg);
  }

  /**
   * Upload → store → extract → review-queue. Extraction runs inline (a
   * commercial invoice takes seconds); the review status tells the caller
   * whether a human needs to look.
   */
  async upload(params: {
    tenantId: string;
    shipmentId: string | null;
    docType: DocType;
    fileName: string;
    fileBytes: Buffer;
    actor: EventActor;
  }) {
    const documentId = randomUUID();
    const storageKey = `${params.tenantId}/${documentId}-${params.fileName.replaceAll("/", "_")}`;
    await this.storage.write(storageKey, params.fileBytes);

    await this.db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        tenantId: params.tenantId,
        shipmentId: params.shipmentId,
        docType: params.docType,
        fileName: params.fileName,
        storageKey,
        reviewStatus: "PENDING_EXTRACTION",
      });
      await appendEvent(
        tx,
        makeEvent({
          definition: DocumentUploaded,
          tenantId: params.tenantId,
          actor: params.actor,
          shipmentId: params.shipmentId,
          payload: {
            documentId,
            docType: params.docType,
            fileName: params.fileName,
            storageKey,
          },
        }),
      );
    });

    if (!isExtractable(params.docType)) {
      // No extraction schema for this type — straight to human review.
      await this.db
        .update(documents)
        .set({ reviewStatus: "PENDING_REVIEW" })
        .where(eq(documents.id, documentId));
      return this.get(documentId, params.tenantId);
    }

    const result = await this.extraction.extract({
      docType: params.docType,
      fileName: params.fileName,
      fileBytes: params.fileBytes,
    });

    await this.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          extractedData: result.extractedData,
          extractionConfidence: result.confidence,
          reviewStatus: result.reviewRequired ? "PENDING_REVIEW" : "APPROVED",
          ...(result.reviewRequired ? {} : { reviewedBy: "auto:high-confidence" }),
        })
        .where(eq(documents.id, documentId));
      if (result.extractedData) {
        await appendEvent(
          tx,
          makeEvent({
            definition: DocumentExtracted,
            tenantId: params.tenantId,
            actor: { kind: "SYSTEM", id: "extraction" },
            shipmentId: params.shipmentId,
            payload: {
              documentId,
              confidence: result.confidence ?? 0,
              reviewRequired: result.reviewRequired,
              extractedData: result.extractedData,
            },
          }),
        );
      }
    });

    return this.get(documentId, params.tenantId);
  }

  async get(documentId: string, tenantId: string) {
    const [doc] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)));
    if (!doc) throw new NotFoundException("Document not found");
    return doc;
  }

  /** The human review queue — everything the LLM wasn't sure about. */
  async reviewQueue(tenantId: string) {
    return this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.reviewStatus, "PENDING_REVIEW"),
        ),
      );
  }

  async review(params: {
    documentId: string;
    tenantId: string;
    decision: "APPROVED" | "REJECTED";
    correctedData?: Record<string, unknown>;
    actor: EventActor;
  }) {
    const doc = await this.get(params.documentId, params.tenantId);
    if (doc.reviewStatus !== "PENDING_REVIEW") {
      throw new ConflictException(`Document is ${doc.reviewStatus}, not PENDING_REVIEW`);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          reviewStatus: params.decision,
          reviewedBy: params.actor.id,
          ...(params.correctedData ? { extractedData: params.correctedData } : {}),
        })
        .where(eq(documents.id, params.documentId));
      if (params.decision === "APPROVED") {
        await appendEvent(
          tx,
          makeEvent({
            definition: DocumentApproved,
            tenantId: params.tenantId,
            actor: params.actor,
            shipmentId: doc.shipmentId,
            payload: { documentId: params.documentId, reviewerId: params.actor.id },
          }),
        );
      }
    });
    return this.get(params.documentId, params.tenantId);
  }
}
