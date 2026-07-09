import { Inject, Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CONFIG, type AppConfig } from "../../config.js";
import { EXTRACTION_SCHEMAS, type ExtractableDocType } from "./extraction-schemas.js";

export interface ExtractionResult {
  extractedData: Record<string, unknown> | null;
  confidence: number | null;
  reviewRequired: boolean;
  /** Why extraction was skipped, if it was. */
  skippedReason?: string;
}

const MEDIA_TYPES: Record<string, "application/pdf" | "image/png" | "image/jpeg" | "image/webp"> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * LLM document extraction: file bytes → structured JSON with confidence.
 * Non-negotiables: everything is human-reviewable, confidence is surfaced,
 * and below-threshold extractions are forced into the review queue. Without
 * an API key the pipeline degrades to manual review — never blocks uploads.
 */
@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private client: Anthropic | null = null;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    if (cfg.ANTHROPIC_API_KEY) {
      this.client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });
    }
  }

  async extract(params: {
    docType: ExtractableDocType;
    fileName: string;
    fileBytes: Buffer;
  }): Promise<ExtractionResult> {
    if (!this.client) {
      return {
        extractedData: null,
        confidence: null,
        reviewRequired: true,
        skippedReason: "ANTHROPIC_API_KEY not configured — manual review required",
      };
    }

    const ext = params.fileName.slice(params.fileName.lastIndexOf(".")).toLowerCase();
    const mediaType = MEDIA_TYPES[ext];
    if (!mediaType) {
      return {
        extractedData: null,
        confidence: null,
        reviewRequired: true,
        skippedReason: `Unsupported file type ${ext} — manual review required`,
      };
    }

    const schema = EXTRACTION_SCHEMAS[params.docType];
    const data = params.fileBytes.toString("base64");
    const documentBlock =
      mediaType === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: mediaType, data } } as const)
        : ({ type: "image", source: { type: "base64", media_type: mediaType, data } } as const);

    try {
      const response = await this.client.messages.parse({
        model: this.cfg.ANTHROPIC_MODEL,
        max_tokens: 16000,
        system:
          "You are a freight-forwarding document extraction system. Extract the requested " +
          "fields exactly as they appear on the document. Return null for any field you " +
          "cannot read with certainty — never guess. All monetary amounts must be integer " +
          "cents in the document's currency. Report your honest overall confidence.",
        messages: [
          {
            role: "user",
            content: [
              documentBlock,
              {
                type: "text",
                text: `Extract the structured data from this ${params.docType.replaceAll("_", " ").toLowerCase()}.`,
              },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(schema) },
      });

      if (response.stop_reason === "refusal" || !response.parsed_output) {
        return {
          extractedData: null,
          confidence: null,
          reviewRequired: true,
          skippedReason: "Extraction produced no parseable output — manual review required",
        };
      }

      const parsed = response.parsed_output as Record<string, unknown> & {
        confidence: number;
      };
      const confidence = Math.max(0, Math.min(1, parsed.confidence));
      return {
        extractedData: parsed,
        confidence,
        reviewRequired: confidence < this.cfg.EXTRACTION_REVIEW_THRESHOLD,
      };
    } catch (err) {
      this.logger.error(
        `Extraction failed for ${params.fileName}: ${err instanceof Error ? err.message : err}`,
      );
      return {
        extractedData: null,
        confidence: null,
        reviewRequired: true,
        skippedReason: "Extraction error — manual review required",
      };
    }
  }
}
