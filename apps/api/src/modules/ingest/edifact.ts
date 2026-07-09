/**
 * Minimal EDIFACT segment parser + IFTSTA status extraction.
 *
 * The segment grammar handling (terminators, release characters, component
 * separators) is real and tested. The STATUS CODE → canonical event mapping
 * is deliberately configuration: carriers and SA parties use different 4405
 * code lists, so each trading partner gets an explicit map at onboarding —
 * never guess what a partner's codes mean.
 */

export interface EdifactSegment {
  tag: string;
  /** Data elements; each element is its component values. */
  elements: string[][];
}

/** Parse raw EDIFACT into segments, honouring the ? release character. */
export function parseSegments(raw: string): EdifactSegment[] {
  const segments: EdifactSegment[] = [];
  let current = "";
  let released = false;
  const flush = () => {
    const trimmed = current.trim();
    current = "";
    if (!trimmed) return;
    // First split (on +) must keep ? pairs intact so the second split
    // (on :) can still tell released separators from real ones.
    const parts = splitOn(trimmed, "+", true);
    const tag = parts[0] ?? "";
    segments.push({
      tag,
      elements: parts.slice(1).map((el) => splitOn(el, ":", false)),
    });
  };
  for (const ch of raw) {
    if (released) {
      // Keep the ? pair intact — splitOn strips it when splitting elements.
      current += ch;
      released = false;
    } else if (ch === "?") {
      current += ch;
      released = true;
    } else if (ch === "'") {
      flush();
    } else if (ch !== "\n" && ch !== "\r") {
      current += ch;
    }
  }
  flush();
  return segments;
}

function splitOn(value: string, sep: string, preserveRelease: boolean): string[] {
  const out: string[] = [];
  let cur = "";
  let released = false;
  for (const ch of value) {
    if (released) {
      cur += ch;
      released = false;
    } else if (ch === "?") {
      if (preserveRelease) cur += ch;
      released = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export interface IftstaStatus {
  messageRef: string;
  consignmentRef: string | null;
  containerNumber: string | null;
  statusCode: string;
  occurredAt: Date | null;
  location: string | null;
}

/** Extract consignment status details from an IFTSTA interchange. */
export function extractIftsta(raw: string): IftstaStatus[] {
  const segments = parseSegments(raw);
  const statuses: IftstaStatus[] = [];
  let messageRef = "";
  let consignmentRef: string | null = null;
  let containerNumber: string | null = null;
  let pending: IftstaStatus | null = null;

  const push = () => {
    if (pending) statuses.push(pending);
    pending = null;
  };

  for (const seg of segments) {
    switch (seg.tag) {
      case "UNH":
        messageRef = seg.elements[0]?.[0] ?? "";
        break;
      case "CNI":
        consignmentRef = seg.elements[1]?.[0] ?? null;
        break;
      case "EQD":
        containerNumber = seg.elements[1]?.[0] ?? null;
        break;
      case "STS": {
        push();
        pending = {
          messageRef,
          consignmentRef,
          containerNumber,
          statusCode: seg.elements[1]?.[0] ?? seg.elements[0]?.[0] ?? "",
          occurredAt: null,
          location: null,
        };
        break;
      }
      case "DTM": {
        if (pending && seg.elements[0]?.[0] === "334") {
          pending.occurredAt = parseEdifactDate(seg.elements[0]?.[1] ?? "");
        }
        break;
      }
      case "LOC": {
        if (pending) pending.location = seg.elements[1]?.[0] ?? null;
        break;
      }
    }
  }
  push();
  return statuses;
}

function parseEdifactDate(value: string): Date | null {
  // CCYYMMDDHHMM (format qualifier 203) or CCYYMMDD (102).
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?$/);
  if (!m) return null;
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? "0"),
      Number(m[5] ?? "0"),
    ),
  );
}
