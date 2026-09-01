/**
 * Application logger — Winston-based with structured JSON output.
 */

import winston from "winston";
import { getConfig } from "./config.js";

let _logger: winston.Logger | null = null;

export function getLogger(): winston.Logger {
  if (_logger) return _logger;

  const config = getConfig();

  _logger = winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      config.nodeEnv === "development"
        ? winston.format.combine(winston.format.colorize(), winston.format.simple())
        : winston.format.json(),
    ),
    defaultMeta: { service: "storekeeper" },
    transports: [new winston.transports.Console()],
  });

  return _logger;
}
