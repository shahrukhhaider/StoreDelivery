/**
 * Server entry point.
 *
 * Sets up Express with security, API routes, static file serving,
 * auth, billing, compliance webhooks, and the background worker.
 */

import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./config.js";
import { getLogger } from "./logger.js";
import { apiRouter } from "./api/routes.js";
import { requestLogger, errorHandler } from "./api/middleware.js";
import { startWorker } from "./jobs/worker.js";
import { authRouter, shopifySession } from "./shopify/auth.js";
import { billingRouter } from "./shopify/billing.js";
import { complianceRouter } from "./shopify/compliance.js";
import { securityHeaders, apiRateLimit } from "./security.js";
import { metricsHandler } from "./observability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const config = loadConfig();
  const app = express();

  // Security headers
  app.use(securityHeaders);

  // Body parsing
  app.use(express.json({ limit: "1mb" }));

  // Request logging
  app.use(requestLogger);

  // Compliance webhooks (before auth — use their own HMAC verification)
  app.use("/webhooks", complianceRouter);

  // Shopify auth routes
  app.use("/auth", authRouter);

  // Shopify session middleware
  app.use(shopifySession);

  // Billing routes
  app.use("/billing", billingRouter);

  // API rate limiting
  app.use("/api", apiRateLimit);

  // API routes
  app.use("/api", apiRouter);

  // Internal metrics endpoint
  app.get("/internal/metrics", metricsHandler);

  // Serve web UI in production
  if (config.nodeEnv === "production") {
    const webDir = join(__dirname, "../web");
    app.use(express.static(webDir));
    // SPA fallback — only for non-API/non-auth routes
    app.get("*", (req, res, next) => {
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/auth") ||
        req.path.startsWith("/billing") ||
        req.path.startsWith("/webhooks") ||
        req.path.startsWith("/internal")
      ) {
        next();
        return;
      }
      res.sendFile(join(webDir, "index.html"));
    });
  }

  // Error handling (must be last)
  app.use(errorHandler);

  return app;
}

// Start server if run directly
const config = loadConfig();
const logger = getLogger();
const app = createApp();

app.listen(config.port, "0.0.0.0", () => {
  logger.info(`Server running on port ${config.port}`, {
    env: config.nodeEnv,
    port: config.port,
  });

  // Start background worker
  startWorker();
});
