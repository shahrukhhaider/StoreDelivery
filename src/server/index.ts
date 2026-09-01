/**
 * Server entry point.
 *
 * Sets up Express, API routes, static file serving, and the background worker.
 */

import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./config.js";
import { getLogger } from "./logger.js";
import { apiRouter } from "./api/routes.js";
import { requestLogger, errorHandler } from "./api/middleware.js";
import { startWorker } from "./jobs/worker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const config = loadConfig();
  const logger = getLogger();
  const app = express();

  // Body parsing
  app.use(express.json({ limit: "1mb" }));

  // Request logging
  app.use(requestLogger);

  // API routes
  app.use("/api", apiRouter);

  // Serve web UI in production
  if (config.nodeEnv === "production") {
    const webDir = join(__dirname, "../web");
    app.use(express.static(webDir));
    app.get("*", (_req, res) => {
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

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`, {
    env: config.nodeEnv,
    port: config.port,
  });

  // Start background worker
  startWorker();
});
