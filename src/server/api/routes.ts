/**
 * API Routes — mount all route modules.
 */

import { Router } from "express";
import { uploadRouter } from "./upload.js";
import { catalogRouter } from "./catalog.js";
import { importRouter } from "./import.js";
import { editRouter } from "./edit.js";
import { syncRouter } from "./sync.js";
import { shopScope } from "./middleware.js";

const apiRouter = Router();

// Apply shop scoping to all API routes
apiRouter.use(shopScope);

// Mount route modules
apiRouter.use("/uploads", uploadRouter);
apiRouter.use("/catalogs", catalogRouter);
apiRouter.use("/catalogs", editRouter);
apiRouter.use("/imports", importRouter);
apiRouter.use("/shopify", syncRouter);

/**
 * GET /api/history — List past uploads with linked catalog + import status.
 */
apiRouter.get("/history", async (req, res, next) => {
  try {
    const { getPrisma } = await import("../db.js");
    const { getShopId } = await import("./middleware.js");
    const prisma = getPrisma();
    const shopId = getShopId(req);

    // Fetch uploads with linked catalogs and import operations
    const uploads = await prisma.catalogUpload.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        catalogs: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: {
            _count: { select: { catalogProducts: true } },
            importOperations: {
              take: 1,
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    const history = uploads.map((upload) => {
      const catalog = upload.catalogs[0] ?? null;
      const operation = catalog?.importOperations[0] ?? null;
      const productCount = catalog?._count?.catalogProducts ?? 0;

      return {
        uploadId: upload.id,
        fileName: upload.fileName,
        format: upload.format,
        uploadStatus: upload.status,
        createdAt: upload.createdAt.toISOString(),
        catalogId: catalog?.id ?? null,
        productCount,
        // Import operation details
        operationId: operation?.id ?? null,
        importStatus: operation?.status ?? null,
        plannedCount: operation?.plannedCount ?? 0,
        successCount: operation?.successCount ?? 0,
        failedCount: operation?.failedCount ?? 0,
        skippedCount: operation?.skippedCount ?? 0,
        completedAt: operation?.completedAt?.toISOString() ?? null,
        startedAt: operation?.createdAt?.toISOString() ?? null,
      };
    });

    res.json({ history });
  } catch (err) {
    next(err);
  }
});

// Health check — verifies DB connectivity
apiRouter.get("/health", async (_req, res) => {
  try {
    const { getPrisma } = await import("../db.js");
    await getPrisma().$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      db: "connected",
      version: "0.1.0",
    });
  } catch {
    res.status(503).json({
      status: "degraded",
      timestamp: new Date().toISOString(),
      db: "unreachable",
    });
  }
});

export { apiRouter };
