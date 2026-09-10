/**
 * Vendor API — VendorProfile (SupplierProfile) management.
 *
 * Endpoints:
 *   GET  /api/vendors                    — list all vendors for the shop
 *   POST /api/vendors                    — create a new vendor
 *   GET  /api/catalogs/:id/vendor        — get the vendor assigned to a catalog
 *   POST /api/catalogs/:id/vendor        — assign (or create-and-assign) a vendor to a catalog
 *   GET  /api/catalogs/:id/vendor/detect — run vendor detection against catalog products
 */

import { Router } from "express";
import { z } from "zod";
import { getPrisma } from "../db.js";
import { getShopId } from "./middleware.js";
import { normalizeVendorName, detectVendor } from "../../engine/vendor/vendor-detection.js";

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/vendors — list all vendors for this shop
// ---------------------------------------------------------------------------

router.get("/", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const vendors = await prisma.supplierProfile.findMany({
      where: { shopId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        schemaFingerprint: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ vendors });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/vendors — create a new vendor
// ---------------------------------------------------------------------------

const createVendorSchema = z.object({
  name: z.string().min(1).max(200).trim(),
});

router.post("/", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);
    const body = createVendorSchema.parse(req.body);

    const normalizedName = normalizeVendorName(body.name);
    if (!normalizedName) {
      res.status(400).json({ error: "INVALID_NAME", message: "Vendor name produces an empty slug" });
      return;
    }

    // Check for existing vendor with same slug
    const existing = await prisma.supplierProfile.findFirst({
      where: { shopId, normalizedName },
    });
    if (existing) {
      res.status(409).json({
        error: "DUPLICATE_VENDOR",
        message: `A vendor with slug "${normalizedName}" already exists`,
        existingId: existing.id,
      });
      return;
    }

    const vendor = await prisma.supplierProfile.create({
      data: {
        shopId,
        name: body.name,
        normalizedName,
      },
      select: { id: true, name: true, normalizedName: true, createdAt: true },
    });

    res.status(201).json({ vendor });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/catalogs/:id/vendor — get vendor assigned to a catalog
// ---------------------------------------------------------------------------

router.get("/:catalogId/vendor", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.catalogId, shopId },
      select: {
        id: true,
        vendorId: true,
        vendor: {
          select: { id: true, name: true, normalizedName: true },
        },
      },
    });

    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    res.json({
      vendorId: catalog.vendorId,
      vendor: catalog.vendor ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/catalogs/:id/vendor — assign vendor to a catalog
//
// Body options:
//   { vendorId: "existing-id" }           ← assign an existing vendor
//   { vendorName: "New Vendor Name" }      ← create and assign a new vendor
// ---------------------------------------------------------------------------

const assignVendorSchema = z.union([
  z.object({ vendorId: z.string().min(1) }),
  z.object({ vendorName: z.string().min(1).max(200).trim() }),
]);

router.post("/:catalogId/vendor", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.catalogId, shopId },
      select: { id: true, schemaFingerprint: true },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const body = assignVendorSchema.parse(req.body);

    let vendorId: string;

    if ("vendorId" in body) {
      // Verify the vendor belongs to this shop
      const vendor = await prisma.supplierProfile.findFirst({
        where: { id: body.vendorId, shopId },
      });
      if (!vendor) {
        res.status(404).json({ error: "VENDOR_NOT_FOUND" });
        return;
      }
      vendorId = vendor.id;
    } else {
      // Create new vendor
      const normalizedName = normalizeVendorName(body.vendorName);
      if (!normalizedName) {
        res.status(400).json({ error: "INVALID_NAME" });
        return;
      }

      const vendor = await prisma.supplierProfile.upsert({
        where: { shopId_normalizedName: { shopId, normalizedName } },
        create: { shopId, name: body.vendorName, normalizedName },
        update: {},
        select: { id: true },
      });
      vendorId = vendor.id;
    }

    // Assign vendor to catalog
    await prisma.catalog.update({
      where: { id: catalog.id },
      data: { vendorId },
    });

    // Also update the vendor's schemaFingerprint if not already set
    await prisma.supplierProfile.updateMany({
      where: { id: vendorId, schemaFingerprint: null },
      data: { schemaFingerprint: catalog.schemaFingerprint },
    });

    const updated = await prisma.supplierProfile.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true, normalizedName: true },
    });

    res.json({ vendorId, vendor: updated });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/catalogs/:id/vendor/detect — detect vendor from catalog products
// ---------------------------------------------------------------------------

router.get("/:catalogId/vendor/detect", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const shopId = getShopId(req);

    const catalog = await prisma.catalog.findFirst({
      where: { id: req.params.catalogId, shopId },
      select: { id: true, schemaFingerprint: true },
    });
    if (!catalog) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    // Collect vendor values from normalized products
    const products = await prisma.catalogProduct.findMany({
      where: { catalogId: catalog.id },
      select: { normalizedJson: true },
    });

    const vendorValues = products
      .map((p) => {
        const data = p.normalizedJson as Record<string, unknown>;
        return typeof data.vendor === "string" ? data.vendor : "";
      })
      .filter(Boolean);

    // Load known vendors for this shop
    const knownVendors = await prisma.supplierProfile.findMany({
      where: { shopId },
      select: { id: true, name: true, normalizedName: true, schemaFingerprint: true },
    });

    const result = detectVendor(
      catalog.schemaFingerprint,
      vendorValues,
      knownVendors,
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { router as vendorRouter };
