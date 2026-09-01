/**
 * File Storage — Section 4
 *
 * Abstract storage interface with local filesystem implementation for dev
 * and S3-compatible implementation for production.
 */

import { mkdir, writeFile, readFile, unlink, access } from "fs/promises";
import { join, dirname } from "path";
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
    // In local dev, just return a path-based URL the dev server can serve
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
// Factory
// ---------------------------------------------------------------------------

let _storage: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (_storage) return _storage;

  const config = getConfig();

  if (config.storageDriver === "s3") {
    // TODO: S3 implementation for production (Milestone D)
    throw new Error("S3 storage not yet implemented — use STORAGE_DRIVER=local");
  }

  _storage = new LocalFileStorage(config.storageLocalDir);
  return _storage;
}
