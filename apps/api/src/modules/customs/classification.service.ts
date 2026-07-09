import { Injectable } from "@nestjs/common";
import { TARIFF_EXTRACT, type TariffLine } from "./tariff-data.js";

export interface ClassificationCandidate {
  hsCode: string;
  description: string;
  generalRateBps: number;
  confidence: number;
}

/** Below this the entry line requires explicit human confirmation. */
export const CLASSIFICATION_CONFIRM_THRESHOLD = 0.75;

/**
 * HS classification over the tariff dataset: keyword scoring today, hybrid
 * retrieval + LLM (with cited headings) as the dataset grows. Whatever the
 * method, the contract holds: candidates carry confidence, and low
 * confidence forces a human to confirm before the entry can be prepared.
 */
@Injectable()
export class ClassificationService {
  classify(description: string, topN = 3): ClassificationCandidate[] {
    const words = description
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter((w) => w.length > 2);
    if (words.length === 0) return [];

    const scored = TARIFF_EXTRACT.map((line) => ({
      line,
      score: this.score(words, line),
    }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    const total = scored.reduce((sum, s) => sum + s.score, 0);
    return scored.map((s) => ({
      hsCode: s.line.hsCode,
      description: s.line.description,
      generalRateBps: s.line.generalRateBps,
      // Confidence blends match strength and separation from rivals.
      confidence:
        Math.round(
          Math.min(0.99, (s.score / Math.max(total, 1)) * Math.min(1, s.score / 2)) * 100,
        ) / 100,
    }));
  }

  private score(words: string[], line: TariffLine): number {
    let score = 0;
    for (const word of words) {
      for (const keyword of line.keywords) {
        if (keyword === word) score += 1;
        else if (keyword.includes(word) || word.includes(keyword)) score += 0.4;
      }
    }
    return score;
  }
}
