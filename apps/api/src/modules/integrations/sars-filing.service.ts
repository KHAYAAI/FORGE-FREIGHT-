import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { complianceFilings, type Db } from "@forge-freight/db";
import { CONFIG, type AppConfig } from "../../config.js";
import { DB } from "../db/db.module.js";

/**
 * Statutory filing to SARS, built here and submitted through the authority's
 * own channel.
 *
 * EXTERNAL API — and one that cannot be enabled by setting an environment
 * variable alone. Reaching the SARS Customs EDI gateway requires the operating
 * company to be registered with a customs client number, to hold an EDI user
 * profile SARS issues on application, and to present a client certificate for
 * mutual TLS. That is a paper process measured in weeks.
 *
 * The design consequence is the whole point of this class. The filing is
 * *built, validated and persisted* whether or not a transport exists: a
 * declaration sitting at QUEUED with a complete, correct payload and a stated
 * reason is worth something — it is exported and captured manually, and it
 * becomes a live submission the day the accreditation lands, with no change to
 * the data model. What would be worth nothing is a system that refuses to
 * record the filing until someone finishes the paperwork.
 *
 * So: `submit()` always writes a row. Unconfigured, it stops at QUEUED with
 * `lastError` naming the missing configuration. Configured, it posts and
 * writes back the authority's reference.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type FilingKind = "SARS_CUSDEC" | "SARS_EXPORT_RELEASE" | "SARS_VAT201";

export interface FilingRequest {
  tenantId: string;
  shipmentId?: string | null;
  kind: FilingKind;
  /** Built by the customs module in the authority's field vocabulary. */
  payload: Record<string, unknown>;
  /**
   * Our idempotency key. Retrying a submission with the same reference must
   * never lodge a second declaration — a duplicate customs entry is a
   * correction the operator then has to unwind with SARS by hand.
   */
  submissionRef: string;
}

export interface FilingResult {
  id: string;
  status: string;
  authorityRef: string | null;
  lastError: string | null;
  /** True when the payload was stored but not transmitted. */
  queuedLocally: boolean;
}

@Injectable()
export class SarsFilingService {
  private readonly logger = new Logger(SarsFilingService.name);

  /** Overridable for tests — Nest injects nothing here. */
  fetchImpl: FetchLike = (url, init) => fetch(url, init);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** What is missing before this channel can carry a real submission. */
  missingConfiguration(): string[] {
    const need: Array<[string, string]> = [
      ["SARS_EDI_URL", this.cfg.SARS_EDI_URL],
      ["SARS_CLIENT_NUMBER", this.cfg.SARS_CLIENT_NUMBER],
      ["SARS_CLIENT_CERT_PATH", this.cfg.SARS_CLIENT_CERT_PATH],
      ["SARS_CLIENT_KEY_PATH", this.cfg.SARS_CLIENT_KEY_PATH],
    ];
    return need.filter(([, v]) => !v.trim()).map(([k]) => k);
  }

  get enabled(): boolean {
    return this.missingConfiguration().length === 0;
  }

  async submit(req: FilingRequest): Promise<FilingResult> {
    const missing = this.missingConfiguration();

    // Upsert on the idempotency key. A retried submission updates the row it
    // already created rather than lodging a second declaration.
    const [row] = await this.db
      .insert(complianceFilings)
      .values({
        tenantId: req.tenantId,
        shipmentId: req.shipmentId ?? null,
        kind: req.kind,
        authority: "SARS",
        status: "QUEUED",
        payload: req.payload,
        submissionRef: req.submissionRef,
      })
      .onConflictDoUpdate({
        target: [
          complianceFilings.tenantId,
          complianceFilings.kind,
          complianceFilings.submissionRef,
        ],
        set: { payload: req.payload },
      })
      .returning();

    const filing = row!;

    if (missing.length > 0) {
      const reason =
        `Not transmitted: SARS Customs EDI is not configured (${missing.join(", ")}). ` +
        `The declaration is stored and can be captured on eFiling. Enabling this channel also requires a ` +
        `customs client number and an EDI user profile issued by SARS.`;
      await this.db
        .update(complianceFilings)
        .set({ lastError: reason })
        .where(eq(complianceFilings.id, filing.id));
      this.logger.warn(`${req.kind} ${req.submissionRef} queued locally — ${missing.join(", ")} unset`);
      return {
        id: filing.id,
        status: "QUEUED",
        authorityRef: null,
        lastError: reason,
        queuedLocally: true,
      };
    }

    try {
      const res = await this.fetchImpl(
        `${this.cfg.SARS_EDI_URL.replace(/\/$/, "")}/declarations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // The gateway identifies the filer by client number; the client
            // certificate is presented at the TLS layer by the deployment,
            // not set here.
            "x-customs-client-number": this.cfg.SARS_CLIENT_NUMBER,
            "idempotency-key": req.submissionRef,
          },
          body: JSON.stringify({ kind: req.kind, ...req.payload }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const reason = `SARS rejected the submission: ${res.status} ${body.slice(0, 500)}`;
        await this.db
          .update(complianceFilings)
          .set({ status: "REJECTED", lastError: reason })
          .where(eq(complianceFilings.id, filing.id));
        return { id: filing.id, status: "REJECTED", authorityRef: null, lastError: reason, queuedLocally: false };
      }

      const body = (await res.json()) as { reference?: string; lrn?: string; mrn?: string };
      const authorityRef = body.mrn ?? body.lrn ?? body.reference ?? null;
      await this.db
        .update(complianceFilings)
        .set({
          status: "SUBMITTED",
          authorityRef,
          responsePayload: body as Record<string, unknown>,
          submittedAt: new Date(),
          lastError: null,
        })
        .where(eq(complianceFilings.id, filing.id));

      return { id: filing.id, status: "SUBMITTED", authorityRef, lastError: null, queuedLocally: false };
    } catch (err) {
      // A network failure is not a rejection: the declaration may or may not
      // have been lodged. It stays QUEUED so the retry — which carries the
      // same idempotency key — resolves the ambiguity on the authority's side.
      const reason = `Transport failure contacting SARS: ${err instanceof Error ? err.message : String(err)}`;
      await this.db
        .update(complianceFilings)
        .set({ lastError: reason })
        .where(eq(complianceFilings.id, filing.id));
      this.logger.error(reason);
      return { id: filing.id, status: "QUEUED", authorityRef: null, lastError: reason, queuedLocally: true };
    }
  }

  async list(tenantId: string, limit = 100) {
    return this.db
      .select()
      .from(complianceFilings)
      .where(eq(complianceFilings.tenantId, tenantId))
      .orderBy(desc(complianceFilings.createdAt))
      .limit(Math.min(limit, 200));
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(complianceFilings)
      .where(and(eq(complianceFilings.id, id), eq(complianceFilings.tenantId, tenantId)));
    if (!row) throw new NotFoundException("Filing not found");
    return row;
  }
}
