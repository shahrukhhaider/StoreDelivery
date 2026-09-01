/**
 * API Routes — mount all route modules.
 */

import { Router } from "express";
import { uploadRouter } from "./upload.js";
import { catalogRouter } from "./catalog.js";
import { shopScope } from "./middleware.js";

const apiRouter = Router();

// Apply shop scoping to all API routes
apiRouter.use(shopScope);

// Mount route modules
apiRouter.use("/uploads", uploadRouter);
apiRouter.use("/catalogs", catalogRouter);

// Health check (no shop scope needed)
apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export { apiRouter };
