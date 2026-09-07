/**
 * Catalog API — catalog summary, products, issues, mappings, plan.
 */

import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../db.js";
import { getStorage } from "../storage/file-storage.js";
import { getLogger } from "../logger.js";
import { processCatalog } from "../../engine/pipeline.js";
import { createHash } from "crypto";
import type { ShopRequest } from "./middleware.js";
import { getShopId } from "./middleware.js";
import type { CatalogFormat } from "@shared/types/catalog.js";
import type { FieldMapping } from "@shared/types/mapping.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

const router = Router();

/**
 * GET /api/catalogs/:id — Catalog summary.
 */
router.get("/:id", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
      include: {
        upload: { select: { fileName: true, format: true } },
        _count: {
          select: {
            catalogProducts: true,
            fieldMappings: true,
          },
        },
      },
    });

    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND", message: "Catalog not found" });
      return;
    }

    // Count issues by severity from product data
    const products = await prisma.catalogProduct.findMany({
      where: { catalogId: catalog.id },
      select: { status: true, normalizedJson: true },
    });

    const statusCounts = {
      ready: 0,
      needs_review: 0,
      blocked: 0,
      pending: 0,
    };
    for (const p of products) {
      statusCounts[p.status as keyof typeof statusCounts]++;
    }

    // Gather issues from all product normalizedJson
    let blockingCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    for (const p of products) {
      const json = p.normalizedJson as Record<string, unknown>;
      // Issues are stored at the catalog level, not per product in the JSON
      // We derive counts from product status
    }
    blockingCount = statusCounts.blocked;
    warningCount = statusCounts.needs_review;

    res.json({
      id: catalog.id,
      shopId: catalog.shopId,
      uploadId: catalog.uploadId,
      fileName: catalog.upload.fileName,
      format: catalog.upload.format,
      schemaFingerprint: catalog.schemaFingerprint,
      productCount: catalog._count.catalogProducts,
      mappingCount: catalog._count.fieldMappings,
      statusCounts,
      issueCounts: { blocking: blockingCount, warning: warningCount, info: infoCount },
      createdAt: catalog.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalogs/:id/mappings — List field mappings.
 */
router.get("/:id/mappings", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const mappings = await prisma.fieldMapping.findMany({
      where: { catalogId: catalog.id },
      orderBy: { sourceColumn: "asc" },
    });

    res.json({
      catalogId: catalog.id,
      mappings: mappings.map((m) => ({
        id: m.id,
        sourceColumn: m.sourceColumn,
        targetField: m.targetField,
        confidence: m.confidence,
        mappingSource: m.mappingSource,
        ignored: m.ignored,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/catalogs/:id/mappings — Update mappings and re-process.
 */
const updateMappingsSchema = z.object({
  mappings: z.array(
    z.object({
      sourceColumn: z.string(),
      targetField: z.string().nullable(),
      ignored: z.boolean().default(false),
    }),
  ),
});

router.put("/:id/mappings", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();
    const logger = getLogger();
    const storage = getStorage();

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
      include: { upload: true },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const body = updateMappingsSchema.parse(req.body);

    // Build FieldMapping array from user input
    const userMappings: FieldMapping[] = body.mappings.map((m) => ({
      sourceColumn: m.sourceColumn,
      targetField: m.targetField as FieldMapping["targetField"],
      confidence: "high" as const,
      mappingSource: "user" as const,
      ignored: m.ignored,
    }));

    // Re-process with updated mappings
    const buffer = await storage.download(catalog.upload.storageKey);
    const result = await processCatalog(buffer, {
      format: catalog.upload.format as CatalogFormat,
      shopId: catalog.shopId,
      uploadId: catalog.uploadId,
      fileName: catalog.upload.fileName,
      existingMappings: userMappings,
    });

    // Delete old mappings and products
    await prisma.fieldMapping.deleteMany({ where: { catalogId: catalog.id } });
    await prisma.catalogProduct.deleteMany({ where: { catalogId: catalog.id } });

    // Persist new mappings
    await prisma.fieldMapping.createMany({
      data: result.mappingResult.mappings.map((m) => ({
        catalogId: catalog.id,
        sourceColumn: m.sourceColumn,
        targetField: m.targetField,
        confidence: m.confidence,
        mappingSource: m.mappingSource as "rule" | "model" | "user",
        ignored: m.ignored,
      })),
    });

    // Persist new products
    if (result.catalog.products.length > 0) {
      const seen = new Set<string>();
      const uniqueProducts = result.catalog.products.filter((p) => {
        if (seen.has(p.sourceKey)) return false;
        seen.add(p.sourceKey);
        return true;
      });

      await prisma.catalogProduct.createMany({
        data: uniqueProducts.map((p) => {
          const hasBlocking = result.catalog.issues.some(
            (i) => i.severity === "blocking" && i.sourceKey === p.sourceKey,
          );
          const hasWarning = result.catalog.issues.some(
            (i) => i.severity === "warning" && i.sourceKey === p.sourceKey,
          );
          return {
            catalogId: catalog.id,
            sourceKey: p.sourceKey,
            normalizedJson: JSON.parse(JSON.stringify(p)),
            status: hasBlocking ? "blocked" : hasWarning ? "needs_review" : "ready",
          };
        }),
      });
    }

    logger.info("Mappings updated and catalog re-processed", {
      catalogId: catalog.id,
      productCount: result.catalog.products.length,
    });

    res.json({
      catalogId: catalog.id,
      productCount: result.catalog.products.length,
      issueCount: result.catalog.issues.length,
      mappingCount: result.mappingResult.mappings.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalogs/:id/products — Paginated product list.
 */
router.get("/:id/products", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const skip = (page - 1) * pageSize;

    const [products, total] = await Promise.all([
      prisma.catalogProduct.findMany({
        where: { catalogId: catalog.id },
        skip,
        take: pageSize,
        orderBy: { sourceKey: "asc" },
      }),
      prisma.catalogProduct.count({ where: { catalogId: catalog.id } }),
    ]);

    res.json({
      catalogId: catalog.id,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      products: products.map((p) => {
        const data = p.normalizedJson as unknown as CatalogProduct;
        return {
          id: p.id,
          sourceKey: p.sourceKey,
          status: p.status,
          title: data.title,
          vendor: data.vendor,
          productType: data.productType,
          variantCount: data.variants?.length ?? 0,
          imageCount: data.images?.length ?? 0,
          firstSku: data.variants?.[0]?.sku ?? null,
          firstPrice: data.variants?.[0]?.price ?? null,
          tags: data.tags ?? [],
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalogs/:id/products/:productId — Single product detail.
 */
router.get("/:id/products/:productId", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const product = await prisma.catalogProduct.findFirst({
      where: { id: req.params.productId, catalogId: catalog.id },
    });
    if (!product) {
      res.status(404).json({ error: "NOT_FOUND", message: "Product not found" });
      return;
    }

    res.json({
      id: product.id,
      sourceKey: product.sourceKey,
      status: product.status,
      data: product.normalizedJson,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalogs/:id/issues — Issues grouped by severity.
 */
router.get("/:id/issues", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    // Re-validate products with overrides applied to get actual issue details
    const products = await prisma.catalogProduct.findMany({
      where: { catalogId: catalog.id },
      select: { id: true, sourceKey: true, status: true, normalizedJson: true },
    });

    // Load overrides for this catalog
    const overrides = await prisma.catalogOverride.findMany({
      where: { catalogId: catalog.id },
    });
    const overridesByProduct = new Map<string, Array<{ field: string; oldValue: unknown; newValue: unknown; source: string }>>();
    for (const o of overrides) {
      const list = overridesByProduct.get(o.productId) ?? [];
      list.push({ field: o.field, oldValue: o.oldValue, newValue: o.newValue, source: o.source });
      overridesByProduct.set(o.productId, list);
    }

    const { validateCatalog } = await import("../../engine/validation/index.js");
    const { applyOverrides } = await import("../../engine/overrides/merge.js");

    const catalogProducts = products.map(
      (p: { id: string; normalizedJson: unknown }) => {
        const source = p.normalizedJson as unknown as import("../../shared/types/catalog.js").CatalogProduct;
        const productOverrides = (overridesByProduct.get(p.id) ?? []).map((o) => ({
          field: o.field,
          oldValue: o.oldValue,
          newValue: o.newValue,
          source: o.source as "user" | "bulk_rule" | "auto_fix",
        }));
        return applyOverrides(source, productOverrides);
      },
    );
    const validationResult = validateCatalog(catalogProducts);

    // Group issues by severity with full details
    const blockingIssues = validationResult.issues
      .filter((i) => i.severity === "blocking")
      .map((i) => ({
        sourceKey: i.sourceKey ?? null,
        code: i.code,
        message: i.message,
        field: i.field ?? null,
      }));

    const warningIssues = validationResult.issues
      .filter((i) => i.severity === "warning")
      .map((i) => ({
        sourceKey: i.sourceKey ?? null,
        code: i.code,
        message: i.message,
        field: i.field ?? null,
      }));

    const issues = {
      blocking: blockingIssues,
      warning: warningIssues,
      skuCoverage: validationResult.skuCoverage,
      summary: {
        total: products.length,
        ready: products.filter((p) => p.status === "ready").length,
        needsReview: products.filter((p) => p.status === "needs_review").length,
        blocked: products.filter((p) => p.status === "blocked").length,
        blockingCount: blockingIssues.length,
        warningCount: warningIssues.length,
      },
    };

    res.json(issues);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/catalogs/:id/plan — Generate import plan.
 */
router.post("/:id/plan", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    // Get all products
    const products = await prisma.catalogProduct.findMany({
      where: { catalogId: catalog.id },
    });

    const included = products.filter((p) => p.status === "ready" || p.status === "needs_review");
    const excluded = products.filter((p) => p.status === "blocked");

    // Count variants and images from included products
    let variantCount = 0;
    let imageCount = 0;
    for (const p of included) {
      const data = p.normalizedJson as unknown as CatalogProduct;
      variantCount += data.variants?.length ?? 0;
      imageCount += data.images?.length ?? 0;
    }

    // Generate idempotency key
    const planHash = createHash("sha256")
      .update(included.map((p) => p.sourceKey).sort().join("|"))
      .digest("hex")
      .slice(0, 12);
    const idempotencyKey = `${getShopId(req)}:${catalog.id}:${planHash}`;

    // Check for existing plan with same idempotency key
    const existing = await prisma.importOperation.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      res.json({
        id: existing.id,
        status: existing.status,
        productCount: existing.plannedCount,
        variantCount,
        imageCount,
        skippedCount: excluded.length,
        idempotencyKey,
        existing: true,
      });
      return;
    }

    // Create import operation
    const operation = await prisma.importOperation.create({
      data: {
        shopId: getShopId(req),
        catalogId: catalog.id,
        status: "planned",
        idempotencyKey,
        plannedCount: included.length,
      },
    });

    res.status(201).json({
      id: operation.id,
      status: operation.status,
      productCount: included.length,
      variantCount,
      imageCount,
      skippedCount: excluded.length,
      idempotencyKey,
      existing: false,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalogs/:id/plan — Get current import plan.
 */
router.get("/:id/plan", async (req, res, next) => {
  try {
    
    const prisma = getPrisma();

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId: getShopId(req) },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const operation = await prisma.importOperation.findFirst({
      where: { catalogId: catalog.id },
      orderBy: { createdAt: "desc" },
    });

    if (!operation) {
      res.status(404).json({ error: "NO_PLAN", message: "No import plan exists for this catalog" });
      return;
    }

    // Re-compute variant/image counts
    const products = await prisma.catalogProduct.findMany({
      where: {
        catalogId: catalog.id,
        status: { in: ["ready", "needs_review"] },
      },
    });

    let variantCount = 0;
    let imageCount = 0;
    for (const p of products) {
      const data = p.normalizedJson as unknown as CatalogProduct;
      variantCount += data.variants?.length ?? 0;
      imageCount += data.images?.length ?? 0;
    }

    res.json({
      id: operation.id,
      status: operation.status,
      productCount: operation.plannedCount,
      variantCount,
      imageCount,
      successCount: operation.successCount,
      failedCount: operation.failedCount,
      skippedCount: operation.skippedCount,
      createdAt: operation.createdAt,
      completedAt: operation.completedAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/catalogs/:id/generate-skus — Generate SKUs for variants missing them.
 *
 * Body: { format?: string, preview?: boolean }
 * - format: template string (default: "{productHandle}-{variantIndex:003}")
 * - preview: if true, return preview samples without applying
 *
 * When preview=false, generated SKUs are applied as overrides with source "bulk_rule".
 */
router.post("/:id/generate-skus", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const logger = getLogger();
    const shopId = getShopId(req);

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const { generateSkus, previewSkus, collectCatalogSkus, DEFAULT_SKU_FORMAT } =
      await import("../../engine/sku/index.js");
    const { applyOverrides } = await import("../../engine/overrides/merge.js");

    const format = (req.body?.format as string) ?? DEFAULT_SKU_FORMAT;
    const isPreview = req.body?.preview === true;

    // Load products with overrides applied
    const dbProducts = await prisma.catalogProduct.findMany({
      where: { catalogId: catalog.id },
    });

    const overrides = await prisma.catalogOverride.findMany({
      where: { catalogId: catalog.id },
    });
    const overridesByProduct = new Map<string, Array<{ field: string; oldValue: unknown; newValue: unknown; source: string }>>();
    for (const o of overrides) {
      const list = overridesByProduct.get(o.productId) ?? [];
      list.push({ field: o.field, oldValue: o.oldValue, newValue: o.newValue, source: o.source });
      overridesByProduct.set(o.productId, list);
    }

    const resolvedProducts = dbProducts.map((p) => {
      const source = p.normalizedJson as unknown as CatalogProduct;
      const productOverrides = (overridesByProduct.get(p.id) ?? []).map((o) => ({
        field: o.field,
        oldValue: o.oldValue,
        newValue: o.newValue,
        source: o.source as "user" | "bulk_rule" | "auto_fix",
      }));
      return applyOverrides(source, productOverrides);
    });

    // Preview mode: return sample SKUs
    if (isPreview) {
      const samples = previewSkus(resolvedProducts, format, 5);
      res.json({ preview: true, format, samples });
      return;
    }

    // Full generation: collect existing SKUs for collision detection
    const existingCatalogSkus = collectCatalogSkus(resolvedProducts);

    const result = generateSkus(resolvedProducts, {
      format,
      existingCatalogSkus,
      // Shopify SKU collision check is deferred to import-time duplicate detection
      // for now — fetching live Shopify data here would add latency
    });

    // If there are collisions, return them as blocking — do not apply
    if (result.collisionCount > 0) {
      res.json({
        preview: false,
        applied: false,
        format,
        totalMissing: result.totalMissing,
        successCount: result.successCount,
        collisionCount: result.collisionCount,
        collisions: result.collisions.slice(0, 20), // cap for response size
      });
      return;
    }

    // Apply generated SKUs as overrides
    // Build a sourceKey → dbProduct.id lookup
    const sourceKeyToDbId = new Map<string, string>();
    for (const p of dbProducts) {
      sourceKeyToDbId.set(p.sourceKey, p.id);
    }

    let appliedCount = 0;
    for (const gen of result.generated) {
      const dbId = sourceKeyToDbId.get(gen.productSourceKey);
      if (!dbId) continue;

      // Create override for variant SKU
      const field = `variants[${gen.variantIndex}].sku`;
      await prisma.catalogOverride.create({
        data: {
          catalogId: catalog.id,
          productId: dbId,
          field,
          oldValue: Prisma.JsonNull,
          newValue: gen.sku,
          source: "bulk_rule",
        },
      });

      // Also set skuSource provenance
      const sourceField = `variants[${gen.variantIndex}].skuSource`;
      await prisma.catalogOverride.create({
        data: {
          catalogId: catalog.id,
          productId: dbId,
          field: sourceField,
          oldValue: Prisma.JsonNull,
          newValue: "STOREDELIVERY_GENERATED",
          source: "bulk_rule",
        },
      });

      appliedCount++;
    }

    logger.info("SKUs generated and applied", {
      catalogId: catalog.id,
      format,
      totalMissing: result.totalMissing,
      applied: appliedCount,
    });

    res.json({
      preview: false,
      applied: true,
      format,
      totalMissing: result.totalMissing,
      successCount: appliedCount,
      collisionCount: 0,
      collisions: [],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalogs/:id/reconciliation — Reconciliation summary and classifications.
 */
router.get("/:id/reconciliation", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    // Find the latest CatalogRun for this catalog
    const latestRun = await prisma.catalogRun.findFirst({
      where: { catalogId: catalog.id, shopId },
      orderBy: { startedAt: "desc" },
      include: {
        items: {
          orderBy: { sourceProductKey: "asc" },
          select: {
            id: true,
            sourceProductKey: true,
            classification: true,
            proposedAction: true,
            matchedShopifyId: true,
            confidence: true,
            matchEvidence: true,
            merchantConfirmed: true,
          },
        },
      },
    });

    if (!latestRun) {
      res.json({
        catalogId: catalog.id,
        hasRun: false,
        summary: null,
        classifications: [],
      });
      return;
    }

    res.json({
      catalogId: catalog.id,
      hasRun: true,
      catalogRunId: latestRun.id,
      supplierProfileId: latestRun.supplierProfileId,
      summary: {
        totalProducts: latestRun.totalProducts,
        existingMapped: latestRun.mappedCount,
        likelyExisting: latestRun.matchedCount,
        newProducts: latestRun.newCount,
        needsReview: latestRun.reviewCount,
      },
      classifications: latestRun.items,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/catalogs/:id/reconciliation/confirm — Confirm candidate matches.
 */
router.post("/:id/reconciliation/confirm", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.id, shopId },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const sourceProductKeys = req.body?.sourceProductKeys as string[] | undefined;
    if (!sourceProductKeys || !Array.isArray(sourceProductKeys) || sourceProductKeys.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "sourceProductKeys array required" });
      return;
    }

    // Find latest run
    const latestRun = await prisma.catalogRun.findFirst({
      where: { catalogId: catalog.id, shopId },
      orderBy: { startedAt: "desc" },
    });

    if (!latestRun) {
      res.status(400).json({ error: "NO_RUN", message: "No reconciliation run found for this catalog" });
      return;
    }

    const { confirmCandidateMatches } = await import("../reconciliation/reconciliation-service.js");

    const result = await confirmCandidateMatches(
      shopId,
      latestRun.supplierProfileId,
      latestRun.id,
      sourceProductKeys,
    );

    res.json({
      catalogId: catalog.id,
      catalogRunId: latestRun.id,
      confirmed: result.confirmed,
      requested: sourceProductKeys.length,
    });
  } catch (err) {
    next(err);
  }
});

export { router as catalogRouter };
