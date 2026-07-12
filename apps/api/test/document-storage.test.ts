import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createDocumentStorage, LocalDiskStorage, S3DocumentStorage } from "../src/modules/documents/storage.js";

describe("LocalDiskStorage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "doc-storage-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes bytes under the base dir, creating nested dirs as needed", async () => {
    const storage = new LocalDiskStorage(dir);
    await storage.write("tenant-1/doc-1-invoice.pdf", Buffer.from("hello"));
    const content = readFileSync(join(dir, "tenant-1/doc-1-invoice.pdf"), "utf8");
    expect(content).toBe("hello");
  });
});

describe("S3DocumentStorage", () => {
  it("sends a PutObjectCommand with the bucket, key, and body", async () => {
    const sendSpy = vi.fn().mockResolvedValue({});
    const storage = new S3DocumentStorage("my-bucket", "af-south-1");
    // Swap the internal client for a stub — this is a thin wrapper around
    // the SDK, so the contract worth testing is "did we ask S3 for the
    // right bucket/key/body," not the SDK's own HTTP behavior.
    (storage as unknown as { client: { send: typeof sendSpy } }).client = { send: sendSpy };

    await storage.write("tenant-1/doc-1-invoice.pdf", Buffer.from("hello"));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0]![0];
    expect(command.input).toEqual({
      Bucket: "my-bucket",
      Key: "tenant-1/doc-1-invoice.pdf",
      Body: Buffer.from("hello"),
    });
  });
});

describe("createDocumentStorage", () => {
  it("returns LocalDiskStorage when DOC_STORAGE_DRIVER=local", () => {
    const cfg = loadConfig({ AUTH_MODE: "dev", DOC_STORAGE_DRIVER: "local" } as NodeJS.ProcessEnv);
    expect(createDocumentStorage(cfg)).toBeInstanceOf(LocalDiskStorage);
  });

  it("returns S3DocumentStorage when DOC_STORAGE_DRIVER=s3", () => {
    const cfg = loadConfig({
      AUTH_MODE: "dev",
      DOC_STORAGE_DRIVER: "s3",
      DOC_STORAGE_S3_BUCKET: "my-bucket",
    } as NodeJS.ProcessEnv);
    expect(createDocumentStorage(cfg)).toBeInstanceOf(S3DocumentStorage);
  });
});

describe("config validation", () => {
  it("refuses to boot in production with DOC_STORAGE_DRIVER=local", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        AUTH_MODE: "jwt",
        AUTH_ISSUER: "https://issuer.example",
        KAFKA_BROKERS: "broker:9092",
        TEMPORAL_ADDRESS: "temporal:7233",
        INGEST_API_KEY: "key",
        YENTE_URL: "https://yente.example",
        DOC_STORAGE_DRIVER: "local",
      } as NodeJS.ProcessEnv),
    ).toThrow(/DOC_STORAGE_DRIVER must be 's3'/);
  });

  it("refuses DOC_STORAGE_DRIVER=s3 without a bucket", () => {
    expect(() =>
      loadConfig({ AUTH_MODE: "dev", DOC_STORAGE_DRIVER: "s3" } as NodeJS.ProcessEnv),
    ).toThrow(/DOC_STORAGE_S3_BUCKET is required/);
  });
});
