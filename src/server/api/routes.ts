/**
 * API Routes — mount all route modules.
 */

import { Router } from "express";
import { uploadRouter } from "./upload.js";
import { catalogRouter } from "./catalog.js";
import { importRouter } from "./import.js";
import { shopScope } from "./middleware.js";

const apiRouter = Router();

// Apply shop scoping to all API routes
apiRouter.use(shopScope);

// Mount route modules
apiRouter.use("/uploads", uploadRouter);
apiRouter.use("/catalogs", catalogRouter);
apiRouter.use("/imports", importRouter);

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
