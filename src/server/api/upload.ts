/**
 * Upload API — POST /api/uploads, GET /api/uploads/:id
 */

import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { getConfig } from "../config.js";
import { getPrisma } from "../db.js";
import { getStorage } from "../storage/file-storage.js";
import { getLogger } from "../logger.js";
import type { ShopRequest } from "./middleware.js";
import { getShopId } from "./middleware.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // overridden at runtime
});

/**
 * POST /api/uploads — Upload a CSV or XLSX file.
 */
router.post("/", upload.single("file"), async (req, res, next) => {
  try {
    
    const shopId = getShopId(req);
    const config = getConfig();
    const logger = getLogger();
    const prisma = getPrisma();
    const storage = getStorage();

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "NO_FILE", message: "No file uploaded" });
      return;
    }

    // Validate size
    const maxBytes = config.maxUploadSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      res.status(400).json({
        error: "FILE_TOO_LARGE",
        message: `File size exceeds ${config.maxUploadSizeMb}MB limit`,
      });
      return;
    }

    // Validate format
    const originalName = file.originalname.toLowerCase();
    let format: "csv" | "xlsx";
    if (originalName.endsWith(".csv") || originalName.endsWith(".tsv")) {
      format = "csv";
    } else if (originalName.endsWith(".xlsx") || originalName.endsWith(".xls")) {
      format = "xlsx";
    } else {
      res.status(400).json({
        error: "INVALID_FORMAT",
        message: "Only CSV and XLSX files are supported",
      });
      return;
    }

    // Store file
    const storageKey = `uploads/${shopId}/${nanoid()}/${file.originalname}`;
    await storage.upload(storageKey, file.buffer);

    logger.info("File uploaded", {
      shopId,
      fileName: file.originalname,
      format,
      size: file.size,
      storageKey,
    });

    // Create DB record
    const uploadRecord = await prisma.catalogUpload.create({
      data: {
        shopId,
        fileName: file.originalname,
        storageKey,
        format,
        status: "pending",
      },
    });

    res.status(201).json({
      id: uploadRecord.id,
      fileName: uploadRecord.fileName,
      format,
      status: uploadRecord.status,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/uploads/:id — Check upload status.
 */
router.get("/:id", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();

    const record = await prisma.catalogUpload.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
      include: {
        catalogs: {
          select: { id: true },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!record) {
      res.status(404).json({ error: "NOT_FOUND", message: "Upload not found" });
      return;
    }

    res.json({
      id: record.id,
      fileName: record.fileName,
      format: record.format,
      status: record.status,
      catalogId: record.catalogs[0]?.id ?? null,
      createdAt: record.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

export { router as uploadRouter };
