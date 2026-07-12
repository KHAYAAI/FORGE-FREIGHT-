import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppConfig } from "../../config.js";

/**
 * Document bytes go somewhere durable, keyed by storageKey (already
 * tenant-prefixed by the caller). Two backends:
 *
 * - local: writes under DOC_STORAGE_DIR. Fine for a single-process dev
 *   setup; breaks the moment there's more than one API replica, since each
 *   Fargate task has its own ephemeral disk — a document uploaded to one
 *   task doesn't exist on another.
 * - s3: the production backend. Credentials come from the ECS task role's
 *   default credential chain — nothing to configure beyond the bucket name.
 *
 * Config validation refuses to boot with driver=local in production, so
 * this isn't a footgun that's only discovered once a second task starts.
 */
export interface DocumentStorage {
  write(storageKey: string, bytes: Buffer): Promise<void>;
}

export class LocalDiskStorage implements DocumentStorage {
  constructor(private readonly baseDir: string) {}

  async write(storageKey: string, bytes: Buffer): Promise<void> {
    const fullPath = join(this.baseDir, storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, bytes);
  }
}

export class S3DocumentStorage implements DocumentStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
  ) {
    this.client = new S3Client({ region });
  }

  async write(storageKey: string, bytes: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: bytes }),
    );
  }
}

export function createDocumentStorage(cfg: AppConfig): DocumentStorage {
  if (cfg.DOC_STORAGE_DRIVER === "s3") {
    return new S3DocumentStorage(cfg.DOC_STORAGE_S3_BUCKET, cfg.DOC_STORAGE_S3_REGION);
  }
  return new LocalDiskStorage(cfg.DOC_STORAGE_DIR);
}
