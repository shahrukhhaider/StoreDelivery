/**
 * Inline Edit API — issues, product edits, bulk edits, auto-fix, preview, undo.
 *
 * All edit operations store CatalogOverrides (temporary).
 * Import snapshot is created at import time (permanent).
 */

import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../db.js";
import { getLogger } from "../logger.js";
import { getShopId } from "./middleware.js";
import { applyOverrides, computeDiff, type Override } from "../../engine/overrides/merge.js";
import { detectAllAutoFixes } from "../../engine/overrides/auto-fix.js";
import { classifyIssueType } from "../../engine/overrides/issue-filter.js";
import { validateCatalog } from "../../engine/validation/validation-engine.js";
import type { CatalogProduct } from "../../shared/types/catalog.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helper: load catalog with shop check
// ---------------------------------------------------------------------------

async function loadCatalog(catalogId: string, shopId: string) {
  const prisma = getPrisma();
  return prisma.catalog.findFirst({
    where: { id: catalogId, shopId },
  });
}

async function loadProductsWithOverrides(catalogId: string) {
  const prisma = getPrisma();

  const products = await prisma.catalogProduct.findMany({
    where: { catalogId },
    orderBy: { sourceKey: "asc" },
  });

  const overrides = await prisma.catalogOverride.findMany({
    where: { catalogId },
  });

  // Group overrides by product ID
  const overridesByProduct = new Map<string, Override[]>();
  for (const o of overrides) {
    const list = overridesByProduct.get(o.productId) ?? [];
    list.push({
      field: o.field,
      oldValue: o.oldValue,
      newValue: o.newValue,
      source: o.source as Override["source"],
    });
    overridesByProduct.set(o.productId, list);
  }

  return { products, overridesByProduct };
}

// ---------------------------------------------------------------------------
// P1.4: Enhanced Issues API
// GET /api/catalogs/:id/edit/issues
// ---------------------------------------------------------------------------

router.get("/:id/edit/issues", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const { products, overridesByProduct } = await loadProductsWithOverrides(catalog.id);

    // Apply overrides to get resolved products
    const resolvedProducts = products.map((p) => {
      const source = p.normalizedJson as unknown as CatalogProduct;
      const productOverrides = overridesByProduct.get(p.id) ?? [];
      return applyOverrides(source, productOverrides);
    });

    // Run validation on resolved products
    const validationResult = validateCatalog(resolvedProducts);

    // Parse filters
    const typeFilter = req.query.type as string | undefined;
    const severityFilter = req.query.severity as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));

    let filtered = validationResult.issues;
    if (typeFilter) {
      filtered = filtered.filter((i) => classifyIssueType(i.code) === typeFilter);
    }
    if (severityFilter) {
      filtered = filtered.filter((i) => i.severity === severityFilter);
    }

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

    // Count by type and severity — both issue counts and unique product counts
    const typeCounts: Record<string, number> = {};
    const severityCounts: Record<string, number> = {};
    const typeProductKeys: Record<string, Set<string>> = {};
    const severityProductKeys: Record<string, Set<string>> = {};

    for (const issue of validationResult.issues) {
      const t = classifyIssueType(issue.code);
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
      severityCounts[issue.severity] = (severityCounts[issue.severity] ?? 0) + 1;

      // Track unique product keys per filter
      if (issue.sourceKey) {
        if (!typeProductKeys[t]) typeProductKeys[t] = new Set();
        typeProductKeys[t].add(issue.sourceKey);
        if (!severityProductKeys[issue.severity]) severityProductKeys[issue.severity] = new Set();
        severityProductKeys[issue.severity].add(issue.sourceKey);
      }
    }

    // Convert sets to counts
    const typeProductCounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(typeProductKeys)) {
      typeProductCounts[k] = v.size;
    }
    const severityProductCounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(severityProductKeys)) {
      severityProductCounts[k] = v.size;
    }

    // Count overrides
    const overrideCount = Array.from(overridesByProduct.values()).reduce(
      (sum, list) => sum + list.length, 0,
    );

    // Catalog-level issues (no sourceKey) — e.g. DUPLICATE_SKU, DUPLICATE_BARCODE
    const catalogLevelWarningCount = validationResult.issues.filter(
      (i) => i.severity === "warning" && !i.sourceKey,
    ).length;
    const catalogLevelBlockingCount = validationResult.issues.filter(
      (i) => i.severity === "blocking" && !i.sourceKey,
    ).length;

    res.json({
      issues: paginated.map((i) => ({
        code: i.code,
        message: i.message,
        severity: i.severity,
        sourceKey: i.sourceKey ?? null,
        field: i.field ?? null,
        type: classifyIssueType(i.code),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      summary: {
        total: validationResult.issues.length,
        blocking: severityCounts["blocking"] ?? 0,
        warning: severityCounts["warning"] ?? 0,
        info: severityCounts["info"] ?? 0,
        autoFixed: validationResult.autoFixedCount,
        overrideCount,
      },
      typeCounts,
      severityCounts,
      typeProductCounts,
      severityProductCounts,
      /** Catalog-level warning/blocking counts (issues with no sourceKey, e.g. DUPLICATE_SKU) */
      catalogLevelWarningCount,
      catalogLevelBlockingCount,
      totalProducts: products.length,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// P1.5: Single Product Edit
// PATCH /api/catalogs/:id/edit/products/:productId
// ---------------------------------------------------------------------------

const patchProductSchema = z.object({
  edits: z.array(z.object({
    field: z.string(),
    value: z.unknown(),
  })),
});

router.patch("/:id/edit/products/:productId", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const prisma = getPrisma();
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const product = await prisma.catalogProduct.findFirst({
      where: { id: req.params.productId, catalogId: catalog.id },
    });
    if (!product) { res.status(404).json({ error: "PRODUCT_NOT_FOUND" }); return; }

    const body = patchProductSchema.parse(req.body);
    const source = product.normalizedJson as unknown as CatalogProduct;

    // Create overrides for each edit
    const createdOverrides = [];
    for (const edit of body.edits) {
      // Get old value from source using the field path
      const oldValue = getNestedValue(source, edit.field);

      const override = await prisma.catalogOverride.create({
        data: {
          catalogId: catalog.id,
          productId: product.id,
          field: edit.field,
          oldValue: oldValue !== undefined ? (oldValue as Prisma.InputJsonValue) : Prisma.JsonNull,
          newValue: edit.value as Prisma.InputJsonValue,
          source: "user",
        },
      });
      createdOverrides.push(override);
    }

    // Apply all overrides (existing + new) to show resolved state
    const allOverrides = await prisma.catalogOverride.findMany({
      where: { catalogId: catalog.id, productId: product.id },
    });
    const overrideList: Override[] = allOverrides.map((o) => ({
      field: o.field,
      oldValue: o.oldValue,
      newValue: o.newValue,
      source: o.source as Override["source"],
    }));

    const resolved = applyOverrides(source, overrideList);

    // Re-validate
    const validation = validateCatalog([resolved]);

    res.json({
      productId: product.id,
      sourceKey: product.sourceKey,
      source,
      resolved,
      overrides: createdOverrides.map((o) => ({
        id: o.id,
        field: o.field,
        oldValue: o.oldValue,
        newValue: o.newValue,
      })),
      issues: validation.issues,
      diff: computeDiff(source, resolved),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// P1.6: Bulk Edit
// POST /api/catalogs/:id/edit/bulk
// ---------------------------------------------------------------------------

const bulkEditSchema = z.object({
  action: z.enum(["set_value", "replace_value", "clear_value"]),
  field: z.string(),
  value: z.unknown().optional(),
  replaceFrom: z.string().optional(),
  // Pattern: how to generate the value per product/variant
  // "static" (default) = same value for all
  // "template" = use {sourceKey}, {index} placeholders
  // "per_variant" = apply to all variants with {variantIndex} for uniqueness
  pattern: z.enum(["static", "template", "per_variant"]).optional(),
  filter: z.object({
    status: z.string().optional(),
    sourceKeys: z.array(z.string()).optional(),
  }).optional(),
});

/**
 * Expand a template string using product/variant context.
 * Supports: {sourceKey}, {index}, {variantIndex}
 */
function expandTemplate(
  template: string,
  context: { sourceKey: string; index: number; variantIndex?: number },
): string {
  let result = template;
  result = result.replace(/\{sourceKey\}/g, context.sourceKey);
  result = result.replace(/\{index\}/g, String(context.index + 1).padStart(3, "0"));
  if (context.variantIndex !== undefined) {
    result = result.replace(/\{variantIndex\}/g, String(context.variantIndex + 1).padStart(3, "0"));
  }
  return result;
}

router.post("/:id/edit/bulk", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const prisma = getPrisma();
    const logger = getLogger();
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const body = bulkEditSchema.parse(req.body);
    const pattern = body.pattern ?? "static";

    // Load affected products
    const where: Record<string, unknown> = { catalogId: catalog.id };
    if (body.filter?.status) where.status = body.filter.status;
    if (body.filter?.sourceKeys) where.sourceKey = { in: body.filter.sourceKeys };

    const products = await prisma.catalogProduct.findMany({ where: where as never });

    let affectedCount = 0;
    let invalidCount = 0;
    let overridesCreated = 0;

    for (let pi = 0; pi < products.length; pi++) {
      const product = products[pi];
      const source = product.normalizedJson as unknown as CatalogProduct;

      // Determine which fields to apply to
      const isVariantWildcard = body.field.includes("[*]");
      const variantCount = source.variants?.length ?? 1;

      // Build list of (field, newValue) pairs for this product
      const edits: Array<{ field: string; newValue: unknown }> = [];

      if (isVariantWildcard && (pattern === "per_variant" || pattern === "template")) {
        // Apply to all variants: expand variants[*].sku → variants[0].sku, variants[1].sku, etc.
        const baseField = body.field.replace("[*]", "");
        for (let vi = 0; vi < variantCount; vi++) {
          const expandedField = `variants[${vi}]${baseField.startsWith(".") ? baseField : "." + baseField}`;
          const realField = body.field.replace("[*]", `[${vi}]`);

          let val: unknown;
          if (body.action === "clear_value") {
            val = null;
          } else if (body.action === "set_value") {
            const tpl = String(body.value ?? "");
            val = expandTemplate(tpl, { sourceKey: source.sourceKey ?? product.sourceKey, index: pi, variantIndex: vi });
          } else if (body.action === "replace_value") {
            const oldVal = getNestedValue(source, realField);
            if (typeof oldVal === "string" && body.replaceFrom) {
              val = oldVal.replace(body.replaceFrom, String(body.value ?? ""));
            } else { continue; }
          }

          edits.push({ field: realField, newValue: val });
        }
      } else if (pattern === "template") {
        // Single field with template expansion
        const tpl = String(body.value ?? "");
        const val = expandTemplate(tpl, { sourceKey: source.sourceKey ?? product.sourceKey, index: pi });
        edits.push({ field: body.field, newValue: val });
      } else {
        // Static: same value for all
        let val: unknown;
        if (body.action === "clear_value") val = null;
        else if (body.action === "set_value") val = body.value;
        else if (body.action === "replace_value") {
          const oldVal = getNestedValue(source, body.field);
          if (typeof oldVal === "string" && body.replaceFrom) {
            val = oldVal.replace(body.replaceFrom, String(body.value ?? ""));
          } else { continue; }
        }
        edits.push({ field: body.field, newValue: val });
      }

      if (edits.length === 0) continue;

      // Validate all edits together
      const testOverrides: Override[] = edits.map((e) => ({
        field: e.field,
        oldValue: getNestedValue(source, e.field),
        newValue: e.newValue,
        source: "bulk_rule" as const,
      }));
      const resolved = applyOverrides(source, testOverrides);
      const validation = validateCatalog([resolved]);

      if (validation.blockingCount > 0) {
        invalidCount++;
        continue;
      }

      // Create overrides
      for (const edit of edits) {
        const oldValue = getNestedValue(source, edit.field);
        if (JSON.stringify(oldValue) === JSON.stringify(edit.newValue)) continue;

        await prisma.catalogOverride.create({
          data: {
            catalogId: catalog.id,
            productId: product.id,
            field: edit.field,
            oldValue: oldValue !== undefined ? (oldValue as Prisma.InputJsonValue) : Prisma.JsonNull,
            newValue: edit.newValue as Prisma.InputJsonValue,
            source: "bulk_rule",
          },
        });
        overridesCreated++;
      }
      affectedCount++;
    }

    logger.info("Bulk edit applied", {
      catalogId: catalog.id,
      action: body.action,
      field: body.field,
      pattern,
      affected: affectedCount,
      invalid: invalidCount,
      overridesCreated,
    });

    res.json({
      affected: affectedCount,
      invalid: invalidCount,
      total: products.length,
      overridesCreated,
      pattern,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// P1.7: Auto-Fix
// POST /api/catalogs/:id/edit/auto-fix
// ---------------------------------------------------------------------------

router.post("/:id/edit/auto-fix", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const prisma = getPrisma();
    const logger = getLogger();
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const products = await prisma.catalogProduct.findMany({
      where: { catalogId: catalog.id },
    });

    const catalogProducts = products.map(
      (p) => p.normalizedJson as unknown as CatalogProduct,
    );

    const summary = detectAllAutoFixes(catalogProducts);

    // Store as overrides — match overrides to product DB IDs
    let storedCount = 0;
    let overrideIdx = 0;
    for (const product of products) {
      const source = product.normalizedJson as unknown as CatalogProduct;
      // Find overrides for this product's source key
      const productFixes = summary.overrides.filter((o) => {
        // Match by index — overrides are in same order as products
        return true; // We'll use a better approach below
      });
    }

    // Better: re-detect per product and store
    for (const product of products) {
      const source = product.normalizedJson as unknown as CatalogProduct;
      const { detectAutoFixes } = await import("../../engine/overrides/auto-fix.js");
      const fixes = detectAutoFixes(source);

      for (const fix of fixes) {
        // Check if this override already exists
        const existing = await prisma.catalogOverride.findFirst({
          where: {
            catalogId: catalog.id,
            productId: product.id,
            field: fix.field,
            source: "auto_fix",
          },
        });
        if (existing) continue;

        await prisma.catalogOverride.create({
          data: {
            catalogId: catalog.id,
            productId: product.id,
            field: fix.field,
            oldValue: fix.oldValue as Prisma.InputJsonValue ?? Prisma.JsonNull,
            newValue: fix.newValue as Prisma.InputJsonValue,
            source: "auto_fix",
          },
        });
        storedCount++;
      }
    }

    logger.info("Auto-fix applied", {
      catalogId: catalog.id,
      totalFixed: storedCount,
      breakdown: summary.breakdown,
    });

    res.json({
      totalFixed: storedCount,
      breakdown: summary.breakdown,
      totalProducts: products.length,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// P1.8: Issue Resolve / Ignore (stub — issues are derived, not stored)
// POST /api/catalogs/:id/edit/issues/resolve
// POST /api/catalogs/:id/edit/issues/ignore
// ---------------------------------------------------------------------------

// Issues are currently derived from validation, not stored as separate records.
// "Resolving" an issue means fixing the underlying product data (via overrides).
// "Ignoring" an issue would need a separate ignored_issues table — deferred for now.
// These endpoints acknowledge the action for the UI.

router.post("/:id/edit/issues/resolve", async (req, res) => {
  res.json({ status: "ok", message: "Issues are resolved by editing the underlying product data." });
});

router.post("/:id/edit/issues/ignore", async (req, res) => {
  res.json({ status: "ok", message: "Issue ignore is not yet implemented — edit the product to resolve." });
});

// ---------------------------------------------------------------------------
// P1.9: Preview with Overrides
// GET /api/catalogs/:id/edit/preview
// ---------------------------------------------------------------------------

router.get("/:id/edit/preview", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const { products, overridesByProduct } = await loadProductsWithOverrides(catalog.id);

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const resolvedOnly = req.query.resolved === "true";
    const issueSeverity = req.query.severity as string | undefined;
    const issueType = req.query.issueType as string | undefined;

    const resolvedProducts = products.map((p) => {
      const source = p.normalizedJson as unknown as CatalogProduct;
      const productOverrides = overridesByProduct.get(p.id) ?? [];
      const resolved = applyOverrides(source, productOverrides);
      return {
        id: p.id,
        sourceKey: p.sourceKey,
        status: p.status,
        source: resolvedOnly ? undefined : source,
        resolved,
        hasOverrides: productOverrides.length > 0,
        overrideCount: productOverrides.length,
        diff: productOverrides.length > 0 ? computeDiff(source, resolved) : [],
      };
    });

    // Validate resolved products to get per-product issues
    const allResolved = resolvedProducts.map((p) => p.resolved);
    const validation = validateCatalog(allResolved);

    // If filtering by issue severity or type, only return matching products
    let filtered = resolvedProducts;
    if (issueSeverity || issueType) {
      const matchingKeys = new Set<string>();
      for (const issue of validation.issues) {
        const sevMatch = !issueSeverity || issue.severity === issueSeverity;
        const typeMatch = !issueType || classifyIssueType(issue.code) === issueType;
        if (sevMatch && typeMatch) {
          if (issue.sourceKey) {
            // Per-product issue — add directly
            matchingKeys.add(issue.sourceKey);
          } else {
            // Catalog-level issue (e.g. DUPLICATE_SKU, DUPLICATE_BARCODE) — extract
            // affected sourceKeys from the message: "... in N products: key1, key2"
            const match = issue.message.match(/products?:\s*(.+)$/i);
            if (match) {
              for (const key of match[1].split(",")) {
                const trimmed = key.trim();
                if (trimmed) matchingKeys.add(trimmed);
              }
            }
          }
        }
      }
      filtered = resolvedProducts.filter((p) => matchingKeys.has(p.sourceKey));
    }

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      catalogId: catalog.id,
      products: paginated,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      overrideStats: {
        productsWithOverrides: resolvedProducts.filter((p) => p.hasOverrides).length,
        totalOverrides: Array.from(overridesByProduct.values()).reduce((s, l) => s + l.length, 0),
      },
      validation: {
        blocking: validation.blockingCount,
        warning: validation.warningCount,
        info: validation.infoCount,
      },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// P1.10: Undo
// DELETE /api/catalogs/:id/edit/overrides/:overrideId — single undo
// DELETE /api/catalogs/:id/edit/overrides — clear all
// ---------------------------------------------------------------------------

router.delete("/:id/edit/overrides/:overrideId", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const prisma = getPrisma();
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    await prisma.catalogOverride.deleteMany({
      where: { id: req.params.overrideId, catalogId: catalog.id },
    });

    res.json({ status: "ok", message: "Override removed." });
  } catch (err) { next(err); }
});

router.delete("/:id/edit/overrides", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const prisma = getPrisma();
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const sourceFilter = req.query.source as string | undefined;
    const where: Record<string, unknown> = { catalogId: catalog.id };
    if (sourceFilter) where.source = sourceFilter;

    const deleted = await prisma.catalogOverride.deleteMany({ where: where as never });

    res.json({
      status: "ok",
      deleted: deleted.count,
      message: sourceFilter
        ? `Cleared ${deleted.count} ${sourceFilter} overrides.`
        : `Cleared all ${deleted.count} overrides.`,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// P4.1: Cursor-based pagination for products
// GET /api/catalogs/:id/edit/products
// ---------------------------------------------------------------------------

router.get("/:id/edit/products", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const prisma = getPrisma();
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const cursor = req.query.cursor as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const sort = (req.query.sort as string) || "sourceKey";
    const order = (req.query.order as string) === "desc" ? "desc" : "asc";

    // Build where clause
    const where: Record<string, unknown> = { catalogId: catalog.id };
    if (statusFilter) where.status = statusFilter;

    // Cursor-based query
    const findArgs: Record<string, unknown> = {
      where,
      take: limit + 1, // fetch one extra to determine hasNext
      orderBy: { [sort === "sourceKey" ? "sourceKey" : "id"]: order },
    };

    if (cursor) {
      findArgs.cursor = { id: cursor };
      findArgs.skip = 1; // skip the cursor itself
    }

    const products = await prisma.catalogProduct.findMany(findArgs as never);
    const hasNext = products.length > limit;
    if (hasNext) products.pop(); // remove the extra

    // Load overrides for these products
    const productIds = products.map((p: { id: string }) => p.id);
    const overrides = await prisma.catalogOverride.findMany({
      where: { catalogId: catalog.id, productId: { in: productIds } },
    });

    const overridesByProduct = new Map<string, Array<{ field: string; oldValue: unknown; newValue: unknown; source: string }>>();
    for (const o of overrides) {
      const list = overridesByProduct.get(o.productId) ?? [];
      list.push({ field: o.field, oldValue: o.oldValue, newValue: o.newValue, source: o.source });
      overridesByProduct.set(o.productId, list);
    }

    const items = products.map((p: { id: string; sourceKey: string; status: string; normalizedJson: unknown }) => {
      const source = p.normalizedJson as CatalogProduct;
      const productOverrides = (overridesByProduct.get(p.id) ?? []).map((o) => ({
        field: o.field,
        oldValue: o.oldValue,
        newValue: o.newValue,
        source: o.source as "user" | "bulk_rule" | "auto_fix",
      }));
      const resolved = applyOverrides(source, productOverrides);

      return {
        id: p.id,
        sourceKey: p.sourceKey,
        status: p.status,
        resolved,
        hasOverrides: productOverrides.length > 0,
        overrideCount: productOverrides.length,
      };
    });

    const nextCursor = hasNext && items.length > 0 ? items[items.length - 1].id : null;

    // Total count (for UI display — cached or approximate for large catalogs)
    const total = await prisma.catalogProduct.count({ where: where as never });

    res.json({
      items,
      nextCursor,
      hasNext,
      total,
      limit,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// P3.2: Bulk Similarity Detection
// POST /api/catalogs/:id/edit/similar
// ---------------------------------------------------------------------------

const similarSchema = z.object({
  issueCode: z.string(),
  field: z.string().optional(),
  sourceKey: z.string().optional(),
});

router.post("/:id/edit/similar", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const catalog = await loadCatalog(req.params.id, shopId);
    if (!catalog) { res.status(404).json({ error: "NOT_FOUND" }); return; }

    const body = similarSchema.parse(req.body);
    const { products, overridesByProduct } = await loadProductsWithOverrides(catalog.id);

    // Apply overrides to get resolved products
    const resolvedProducts = products.map((p) => {
      const source = p.normalizedJson as unknown as CatalogProduct;
      const productOverrides = overridesByProduct.get(p.id) ?? [];
      return {
        dbId: p.id,
        sourceKey: p.sourceKey,
        resolved: applyOverrides(source, productOverrides),
      };
    });

    // Re-validate to find which products have this issue
    const allResolved = resolvedProducts.map((p) => p.resolved);
    const validation = validateCatalog(allResolved);

    // Filter issues matching the code (and optionally field)
    const matchingIssues = validation.issues.filter((i) => {
      if (i.code !== body.issueCode) return false;
      if (body.field && i.field !== body.field) return false;
      return true;
    });

    // Get source keys of affected products
    const affectedKeys = [...new Set(matchingIssues.map((i) => i.sourceKey).filter(Boolean))] as string[];

    // Build suggested fix based on issue type
    let suggestedFix: { field: string; value: string; explanation: string; pattern?: string } | null = null;

    if (body.issueCode === "MISSING_SKU") {
      // Suggest prefix-based unique SKUs using sourceKey
      const sampleKey = affectedKeys[0] ?? "PRODUCT";
      suggestedFix = {
        field: "variants[*].sku",
        value: "{sourceKey}-{variantIndex}",
        explanation: `Generate unique SKUs using the product handle as prefix. Each variant gets {handle}-001, {handle}-002, etc.`,
        pattern: "per_variant",
      };
    } else if (body.issueCode === "MISSING_TITLE") {
      // Suggest using vendor + product type or sourceKey as title
      const firstAffected = resolvedProducts.find((p) => p.sourceKey === affectedKeys[0]);
      const vendor = firstAffected?.resolved?.vendor ?? "";
      const type = firstAffected?.resolved?.productType ?? "";
      const suggestedTitle = vendor && type ? `${vendor} ${type}` : affectedKeys[0] ?? "Untitled";
      suggestedFix = {
        field: "title",
        value: suggestedTitle,
        explanation: vendor && type
          ? `Use "{vendor} {product type}" as the product title.`
          : `Use the product handle as the title. Edit to customize.`,
      };
    } else if (body.issueCode === "SUSPICIOUS_HIGH_PRICE" || body.issueCode === "SUSPICIOUS_LOW_PRICE") {
      const firstAffected = resolvedProducts.find((p) => p.sourceKey === affectedKeys[0]);
      const currentPrice = firstAffected?.resolved?.variants?.[0]?.price ?? "";
      suggestedFix = {
        field: "variants[0].price",
        value: currentPrice,
        explanation: `Current price is ${currentPrice}. Edit to correct it.`,
      };
    } else if (body.issueCode === "INVALID_IMAGE_URL") {
      suggestedFix = {
        field: "images",
        value: "",
        explanation: "Fix or remove invalid image URLs.",
      };
    } else if (body.issueCode === "MALFORMED_PRICE") {
      suggestedFix = {
        field: "variants[0].price",
        value: "",
        explanation: "Enter a valid price (e.g. 24.99).",
      };
    } else if (body.issueCode === "EMPTY_OPTION") {
      suggestedFix = {
        field: "variants[0].options",
        value: "Default",
        explanation: "Set a value for the empty option.",
      };
    } else if (body.issueCode === "TITLE_TOO_LONG") {
      const firstAffected = resolvedProducts.find((p) => p.sourceKey === (body.sourceKey ?? affectedKeys[0]));
      const currentTitle = firstAffected?.resolved?.title ?? "";
      suggestedFix = {
        field: "title",
        value: currentTitle.slice(0, 255),
        explanation: `Title is ${currentTitle.length} characters. Truncated to 255 characters — edit to refine.`,
      };
    } else if (body.issueCode === "NEGATIVE_PRICE") {
      suggestedFix = {
        field: "variants[0].price",
        value: "0.00",
        explanation: "Price cannot be negative. Set to 0 for free, or enter the correct price.",
      };
    } else if (body.issueCode === "OPTION_VALUE_TOO_LONG") {
      suggestedFix = {
        field: "variants[0].options",
        value: "",
        explanation: "Option value exceeds 255 characters. Shorten the value.",
      };
    } else if (body.issueCode === "TOO_MANY_OPTIONS") {
      suggestedFix = {
        field: "options",
        value: "",
        explanation: "Shopify allows a maximum of 3 option types (e.g. Color, Size, Material). Go back to column mappings and unmap extra option columns.",
      };
    } else if (body.issueCode === "TOO_MANY_VARIANTS") {
      suggestedFix = {
        field: "variants",
        value: "",
        explanation: "Shopify allows a maximum of 100 variants per product. Split this product or reduce variant combinations in the source file.",
      };
    } else if (body.issueCode === "DUPLICATE_OPTION_VALUES") {
      suggestedFix = {
        field: "variants[0].options",
        value: "",
        explanation: "Two variants have the same option combination. Edit one variant's options to make them unique, or remove the duplicate row from the source file.",
      };
    } else if (body.issueCode === "MISSING_OPTIONS") {
      suggestedFix = {
        field: "options",
        value: "",
        explanation: "Multiple variants exist but no option column is mapped. Go back to column mappings and map an option column (e.g. Color, Size), or map a parent key so each row becomes its own product.",
      };
    } else if (body.issueCode === "AMBIGUOUS_GROUPING") {
      suggestedFix = {
        field: "options",
        value: "",
        explanation: "Rows with the same title were grouped as variants but may be separate products. Go back to column mappings and map a parent key column (e.g. product ID, handle) to control grouping.",
      };
    }

    // Detect all fields from the target product (for context in the side panel)
    // Use the requested sourceKey if provided, otherwise fall back to first affected
    const detectedFields: Array<{ label: string; value: string }> = [];
    const targetKey = body.sourceKey ?? affectedKeys[0];
    if (targetKey) {
      const targetProduct = resolvedProducts.find((p) => p.sourceKey === targetKey);
      if (targetProduct) {
        const r = targetProduct.resolved;
        if (r.title) detectedFields.push({ label: "Title", value: r.title });
        if (r.description) detectedFields.push({ label: "Description", value: r.description.slice(0, 100) + (r.description.length > 100 ? "…" : "") });
        if (r.vendor) detectedFields.push({ label: "Vendor", value: r.vendor });
        if (r.productType) detectedFields.push({ label: "Product Type", value: r.productType });
        if (r.tags?.length) detectedFields.push({ label: "Tags", value: r.tags.join(", ") });
        if (r.variants?.[0]?.sku) detectedFields.push({ label: "SKU", value: r.variants[0].sku });
        if (r.variants?.[0]?.barcode) detectedFields.push({ label: "Barcode", value: r.variants[0].barcode });
        if (r.variants?.[0]?.price) detectedFields.push({ label: "Price", value: r.variants[0].price });
        if (r.variants?.[0]?.compareAtPrice) detectedFields.push({ label: "Compare At Price", value: r.variants[0].compareAtPrice });
        if (r.variants?.[0]?.cost) detectedFields.push({ label: "Cost", value: r.variants[0].cost });
        if (r.variants?.[0]?.inventoryQuantity !== undefined) detectedFields.push({ label: "Inventory", value: String(r.variants[0].inventoryQuantity) });
        if (r.variants?.[0]?.weight !== undefined) detectedFields.push({ label: "Weight", value: `${r.variants[0].weight} ${r.variants[0].weightUnit ?? ""}`.trim() });
        if (r.variants?.length) detectedFields.push({ label: "Variants", value: String(r.variants.length) });
        if (r.images?.length) detectedFields.push({ label: "Images", value: String(r.images.length) });
      }
    }

    res.json({
      issueCode: body.issueCode,
      affectedCount: affectedKeys.length,
      affectedKeys,
      suggestedFix,
      detectedFields,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// P4.3: Async bulk edit processor (for >1000 rows)
// ---------------------------------------------------------------------------

async function processBulkEditAsync(
  catalogId: string,
  products: Array<{ id: string; normalizedJson: unknown }>,
  body: { action: string; field: string; value?: unknown; replaceFrom?: string },
  prisma: ReturnType<typeof getPrisma>,
  logger: ReturnType<typeof getLogger>,
): Promise<void> {
  let affectedCount = 0;
  let invalidCount = 0;

  // Process in chunks of 100 to avoid overwhelming the DB
  const chunkSize = 100;
  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    const overridesToCreate: Array<{
      catalogId: string;
      productId: string;
      field: string;
      oldValue: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      newValue: Prisma.InputJsonValue;
      source: "bulk_rule";
    }> = [];

    for (const product of chunk) {
      const source = product.normalizedJson as CatalogProduct;
      const oldValue = getNestedValue(source, body.field);

      let newValue: unknown;
      switch (body.action) {
        case "set_value": newValue = body.value; break;
        case "replace_value":
          if (typeof oldValue === "string" && body.replaceFrom) {
            newValue = oldValue.replace(body.replaceFrom, String(body.value ?? ""));
          } else { continue; }
          break;
        case "clear_value": newValue = null; break;
        default: continue;
      }

      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;

      const testOverride: Override[] = [{ field: body.field, oldValue, newValue, source: "bulk_rule" }];
      const resolved = applyOverrides(source, testOverride);
      const validation = validateCatalog([resolved]);
      if (validation.blockingCount > 0) { invalidCount++; continue; }

      overridesToCreate.push({
        catalogId,
        productId: product.id,
        field: body.field,
        oldValue: oldValue !== undefined ? (oldValue as Prisma.InputJsonValue) : Prisma.JsonNull,
        newValue: newValue as Prisma.InputJsonValue,
        source: "bulk_rule",
      });
    }

    if (overridesToCreate.length > 0) {
      await prisma.catalogOverride.createMany({ data: overridesToCreate });
      affectedCount += overridesToCreate.length;
    }
  }

  logger.info("Async bulk edit complete", { catalogId, affected: affectedCount, invalid: invalidCount });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNestedValue(obj: unknown, path: string): unknown {
  const segments = path.split(/[.[\]]+/).filter(Boolean);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    const idx = parseInt(seg, 10);
    if (!isNaN(idx)) {
      current = (current as unknown[])[idx];
    } else {
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return current;
}

export { router as editRouter };
