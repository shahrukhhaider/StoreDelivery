/**
 * Prisma client singleton.
 */

import { PrismaClient } from "@prisma/client";
import { getConfig } from "./config.js";

let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;

  const config = getConfig();

  _prisma = new PrismaClient({
    datasourceUrl: config.databaseUrl,
    log:
      config.nodeEnv === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

  return _prisma;
}

export async function disconnectDb(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}
