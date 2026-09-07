/**
 * Import API — execute, status, items, retry.
 */

import { Router } from "express";
import { getPrisma } from "../db.js";
import { getLogger } from "../logger.js";
import { getShopId } from "./middleware.js";
import { executeImport, retryFailedItems } from "../jobs/import-executor.js";

const router = Router();

/**
 * POST /api/imports/:operationId/execute — Start import execution.
 */
router.post("/:operationId/execute", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const logger = getLogger();
    const shopId = getShopId(req);

    const operation = await prisma.importOperation.findFirst({
      where: { id: req.params.operationId, shopId },
    });

    if (!operation) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    if (operation.status !== "planned") {
      res.status(400).json({
        error: "INVALID_STATUS",
        message: `Operation is in status "${operation.status}", can only execute from "planned"`,
      });
      return;
    }

    // Start execution asynchronously
    logger.info("Import execution requested", { operationId: operation.id });

    // Fire and forget — the executor updates status in DB
    executeImport(operation.id).catch((err) => {
      logger.error("Import execution error", {
        operationId: operation.id,
        error: (err as Error).message,
      });
    });

    res.json({
      id: operation.id,
      status: "in_progress",
      message: "Import execution started",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/imports/:operationId — Import status + progress.
 */
router.get("/:operationId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const operation = await prisma.importOperation.findFirst({
      where: { id: req.params.operationId, shopId },
      include: {
        catalog: {
          include: {
            upload: { select: { fileName: true, format: true, createdAt: true } },
          },
        },
      },
    });

    if (!operation) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const total = operation.plannedCount;
    const completed = operation.successCount + operation.failedCount + operation.skippedCount;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Calculate elapsed + ETA
    const startMs = operation.createdAt.getTime();
    const endMs = operation.completedAt ? operation.completedAt.getTime() : Date.now();
    const elapsedMs = endMs - startMs;

    res.json({
      id: operation.id,
      status: operation.status,
      fileName: operation.catalog.upload.fileName,
      fileFormat: operation.catalog.upload.format,
      catalogId: operation.catalogId,
      plannedCount: operation.plannedCount,
      successCount: operation.successCount,
      failedCount: operation.failedCount,
      skippedCount: operation.skippedCount,
      progress,
      elapsedMs,
      createdAt: operation.createdAt,
      completedAt: operation.completedAt,
      uploadedAt: operation.catalog.upload.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/imports/:operationId/items — Paginated import item results.
 */
router.get("/:operationId/items", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const operation = await prisma.importOperation.findFirst({
      where: { id: req.params.operationId, shopId },
    });

    if (!operation) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const statusFilter = req.query.status as string | undefined;

    const where: Record<string, unknown> = { importOperationId: operation.id };
    if (statusFilter) {
      where.status = statusFilter;
    }

    const [items, total] = await Promise.all([
      prisma.importItem.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { sourceProductKey: "asc" },
      }),
      prisma.importItem.count({ where }),
    ]);

    res.json({
      operationId: operation.id,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items: items.map((item) => ({
        id: item.id,
        sourceProductKey: item.sourceProductKey,
        action: item.action,
        status: item.status,
        shopifyProductId: item.shopifyProductId,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/imports/:operationId/retry — Retry failed items.
 */
router.post("/:operationId/retry", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const logger = getLogger();
    const shopId = getShopId(req);

    const operation = await prisma.importOperation.findFirst({
      where: { id: req.params.operationId, shopId },
    });

    if (!operation) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    if (operation.failedCount === 0) {
      res.status(400).json({
        error: "NO_FAILURES",
        message: "No failed items to retry",
      });
      return;
    }

    logger.info("Retry requested", { operationId: operation.id });

    retryFailedItems(operation.id).catch((err) => {
      logger.error("Retry error", {
        operationId: operation.id,
        error: (err as Error).message,
      });
    });

    res.json({
      id: operation.id,
      status: "in_progress",
      message: "Retry started for failed items",
    });
  } catch (err) {
    next(err);
  }
});

export { router as importRouter };

/**
 * GET /api/imports/:operationId/export-errors — Download failed items as CSV.
 */
router.get("/:operationId/export-errors", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const operation = await prisma.importOperation.findFirst({
      where: { id: req.params.operationId, shopId },
    });

    if (!operation) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const failedItems = await prisma.importItem.findMany({
      where: { importOperationId: operation.id, status: "failed" },
      orderBy: { sourceProductKey: "asc" },
    });

    // Build CSV
    const header = "Product Key,Action,Status,Error Code,Error Message\n";
    const rows = failedItems.map((item) => {
      const escape = (v: string | null) => {
        if (!v) return "";
        // Escape quotes and wrap in quotes if contains comma/quote/newline
        const escaped = v.replace(/"/g, '""');
        if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
          return `"${escaped}"`;
        }
        // Sanitize formula injection
        if (/^[=+\-@\t\r]/.test(escaped)) {
          return `"'${escaped}"`;
        }
        return escaped;
      };

      return [
        escape(item.sourceProductKey),
        escape(item.action),
        escape(item.status),
        escape(item.errorCode),
        escape(item.errorMessage),
      ].join(",");
    });

    const csv = header + rows.join("\n") + "\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="import-errors-${operation.id}.csv"`,
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});
