import { BadRequestException } from "@nestjs/common";

/**
 * Keyset pagination over `(createdAt DESC, id DESC)`.
 *
 * Offset pagination drifts: shipments are created while an operator is paging,
 * every new row shifts the window, and rows get skipped or repeated. A keyset
 * cursor names the exact row the next page starts after, so the window stays
 * stable no matter what is written underneath it.
 *
 * The cursor is base64url of `<ISO timestamp>|<uuid>`. It is opaque to callers
 * by convention, not by encryption — it encodes only a position in a list the
 * caller is already authorised to read, and every query re-filters by tenant,
 * so a forged cursor can move the window but never widen it.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw new BadRequestException("Malformed cursor");
  }
  const sep = decoded.lastIndexOf("|");
  if (sep === -1) throw new BadRequestException("Malformed cursor");

  const createdAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime())) throw new BadRequestException("Malformed cursor");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException("Malformed cursor");

  return { createdAt, id };
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Rejects junk rather than silently clamping it — a bad `limit` is a caller bug. */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) {
    throw new BadRequestException(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  return n;
}

export interface Page<T> {
  rows: T[];
  /** Null on the last page. Pass back as `?cursor=` for the next one. */
  nextCursor: string | null;
  /** Total matching the filters, ignoring the cursor — for "42 of 1,204". */
  total: number;
}
