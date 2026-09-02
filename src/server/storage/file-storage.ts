/**
 * File Storage — Section 4
 *
 * Abstract storage interface with:
 * - Local filesystem implementation for development
 * - S3-compatible implementation for production (Railway, AWS, etc.)
 */

import { mkdir, writeFile, readFile, unlink, access } from "fs/promises";
import { join, dirname } from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as s3GetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface FileStorage {
  upload(key: string, buffer: Buffer): Promise<void>;
  download(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Local filesystem implementation (for development)
// ---------------------------------------------------------------------------

export class LocalFileStorage implements FileStorage {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? getConfig().storageLocalDir;
  }

  private resolvePath(key: string): string {
    return join(this.baseDir, key);
  }

  async upload(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
  }

  async download(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  async getSignedUrl(key: string): Promise<string> {
    return `/api/files/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolvePath(key));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// S3-compatible implementation (production)
// ---------------------------------------------------------------------------

export class S3FileStorage implements FileStorage {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const config = getConfig();
    this.bucket = config.storageBucket;

    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: config.storageRegion,
    };

    // Custom endpoint for S3-compatible services (Railway Object Storage, MinIO, etc.)
    if (config.storageEndpoint) {
      clientConfig.endpoint = config.storageEndpoint;
      clientConfig.forcePathStyle = true;
    }

    // Explicit credentials if provided; otherwise uses SDK default chain (IAM roles, env vars)
    if (config.storageAccessKey && config.storageSecretKey) {
      clientConfig.credentials = {
        accessKeyId: config.storageAccessKey,
        secretAccessKey: config.storageSecretKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  async upload(key: string, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
      }),
    );
  }

  async download(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    // Stream body to buffer
    const stream = res.Body;
    if (!stream) throw new Error(`Empty body for key: ${key}`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return s3GetSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _storage: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (_storage) return _storage;

  const config = getConfig();

  if (config.storageDriver === "s3") {
    _storage = new S3FileStorage();
  } else {
    _storage = new LocalFileStorage(config.storageLocalDir);
  }

  return _storage;
}
