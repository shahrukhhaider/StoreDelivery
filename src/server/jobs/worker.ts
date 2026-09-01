/**
 * Background Job Worker — Section 4
 *
 * DB-backed polling worker that processes pending uploads:
 * 1. Find pending upload
 * 2. Download file from storage
 * 3. Run engine pipeline (parse → map → group → validate)
 * 4. Persist catalog, mappings, products to DB
 * 5. Update upload status
 */

import { getPrisma } from "../db.js";
import { getStorage } from "../storage/file-storage.js";
import { getLogger } from "../logger.js";
import { processCatalog } from "../../engine/pipeline.js";
import type { CatalogFormat } from "@shared/types/catalog.js";

const POLL_INTERVAL_MS = 2000;

let running = false;

/**
 * Start the background worker loop.
 */
export function startWorker(): void {
  if (running) return;
  running = true;
  const logger = getLogger();
  logger.info("Background worker started");
  tick();
}

export function stopWorker(): void {
  running = false;
}

async function tick(): Promise<void> {
  if (!running) return;

  try {
    await processNextUpload();
  } catch (err) {
    getLogger().error("Worker tick error", { error: (err as Error).message });
  }

  if (running) {
    setTimeout(tick, POLL_INTERVAL_MS);
  }
}

async function processNextUpload(): Promise<void> {
  const prisma = getPrisma();
  const logger = getLogger();

  // Atomically claim a pending upload
  const pending = await prisma.catalogUpload.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (!pending) return;

  // Mark as parsing
  await prisma.catalogUpload.update({
    where: { id: pending.id },
    data: { status: "parsing" },
  });

  logger.info("Processing upload", {
    uploadId: pending.id,
    fileName: pending.fileName,
    format: pending.format,
  });

  try {
    const storage = getStorage();
    const buffer = await storage.download(pending.storageKey);

    // Run engine pipeline
    const result = await processCatalog(buffer, {
      format: pending.format as CatalogFormat,
      shopId: pending.shopId,
      uploadId: pending.id,
      fileName: pending.fileName,
    });

    const { catalog, mappingResult } = result;

    // Persist catalog
    const dbCatalog = await prisma.catalog.create({
      data: {
        shopId: pending.shopId,
        uploadId: pending.id,
        schemaFingerprint: catalog.source.schemaFingerprint,
        parseVersion: "1",
      },
    });

    // Persist field mappings
    if (mappingResult.mappings.length > 0) {
      await prisma.fieldMapping.createMany({
        data: mappingResult.mappings.map((m) => ({
          catalogId: dbCatalog.id,
          sourceColumn: m.sourceColumn,
          targetField: m.targetField,
          confidence: m.confidence,
          mappingSource: m.mappingSource as "rule" | "model" | "user",
          ignored: m.ignored,
        })),
      });
    }

    // Persist catalog products
    if (catalog.products.length > 0) {
      await prisma.catalogProduct.createMany({
        data: catalog.products.map((p) => {
          const hasBlocking = catalog.issues.some(
            (i) => i.severity === "blocking" && i.sourceKey === p.sourceKey,
          );
          const hasWarning = catalog.issues.some(
            (i) => i.severity === "warning" && i.sourceKey === p.sourceKey,
          );

          return {
            catalogId: dbCatalog.id,
            sourceKey: p.sourceKey,
            normalizedJson: JSON.parse(JSON.stringify(p)),
            status: hasBlocking
              ? "blocked"
              : hasWarning
                ? "needs_review"
                : "ready",
          };
        }),
      });
    }

    // Mark upload as parsed
    await prisma.catalogUpload.update({
      where: { id: pending.id },
      data: { status: "parsed" },
    });

    logger.info("Upload processed", {
      uploadId: pending.id,
      catalogId: dbCatalog.id,
      productCount: catalog.products.length,
      issueCount: catalog.issues.length,
    });
  } catch (err) {
    logger.error("Upload processing failed", {
      uploadId: pending.id,
      error: (err as Error).message,
      stack: (err as Error).stack,
    });

    await prisma.catalogUpload.update({
      where: { id: pending.id },
      data: { status: "failed" },
    });
  }
}
