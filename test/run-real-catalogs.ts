/**
 * Test runner — process real supplier catalogs through the offline engine
 * and print a summary of results.
 *
 * Usage: npx tsx test/run-real-catalogs.ts
 */

import { readFileSync, readdirSync } from "fs";
import { join, extname, basename } from "path";
import { processCatalog, type PipelineResult } from "../src/engine/pipeline.js";
import type { CatalogFormat } from "../src/shared/types/catalog.js";

const CATALOGS_DIR = join(import.meta.dirname, "real-catalogs");

async function main() {
  const files = readdirSync(CATALOGS_DIR).filter(
    (f) => f.endsWith(".csv") || f.endsWith(".xlsx"),
  );

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  StoreKeeper Engine — Real Catalog Test Run`);
  console.log(`  ${files.length} files found in test/real-catalogs/`);
  console.log(`${"=".repeat(70)}\n`);

  const results: Array<{
    file: string;
    success: boolean;
    products: number;
    variants: number;
    images: number;
    blocking: number;
    warnings: number;
    mapped: number;
    unmapped: number;
    needsReview: number;
    duration: number;
    error?: string;
  }> = [];

  for (const file of files) {
    const filePath = join(CATALOGS_DIR, file);
    const ext = extname(file).toLowerCase();
    const format: CatalogFormat = ext === ".xlsx" || ext === ".xls" ? "xlsx" : "csv";

    console.log(`Processing: ${file}`);
    const start = Date.now();

    try {
      const buffer = readFileSync(filePath);
      const result = await processCatalog(buffer, {
        format,
        shopId: "test_shop",
        uploadId: `test_${file}`,
        fileName: file,
      });

      const duration = Date.now() - start;
      const { catalog, mappingResult } = result;

      const variantCount = catalog.products.reduce(
        (sum, p) => sum + p.variants.length,
        0,
      );
      const imageCount = catalog.products.reduce(
        (sum, p) => sum + p.images.length,
        0,
      );
      const blockingCount = catalog.issues.filter(
        (i) => i.severity === "blocking",
      ).length;
      const warningCount = catalog.issues.filter(
        (i) => i.severity === "warning",
      ).length;

      results.push({
        file,
        success: true,
        products: catalog.products.length,
        variants: variantCount,
        images: imageCount,
        blocking: blockingCount,
        warnings: warningCount,
        mapped: mappingResult.mappings.filter((m) => m.targetField !== null).length,
        unmapped: mappingResult.unmapped.length,
        needsReview: mappingResult.needsReview.length,
        duration,
      });

      // Print details
      console.log(`  ✓ ${catalog.products.length} products, ${variantCount} variants, ${imageCount} images`);
      console.log(`    Mappings: ${mappingResult.mappings.filter((m) => m.targetField !== null).length} mapped, ${mappingResult.unmapped.length} unmapped, ${mappingResult.needsReview.length} need review`);
      if (blockingCount > 0 || warningCount > 0) {
        console.log(`    Issues: ${blockingCount} blocking, ${warningCount} warnings`);
      }
      console.log(`    Duration: ${duration}ms`);

      // Print mapping details
      console.log(`    Column mappings:`);
      for (const m of mappingResult.mappings) {
        const target = m.targetField ?? "(unmapped)";
        const conf = m.confidence;
        const icon =
          conf === "high" ? "🟢" : conf === "medium" ? "🟡" : "🔴";
        console.log(`      ${icon} "${m.sourceColumn}" → ${target} [${conf}]`);
      }

      // Print sample product
      if (catalog.products.length > 0) {
        const sample = catalog.products[0];
        console.log(`    Sample product: "${sample.title}"`);
        if (sample.vendor) console.log(`      Vendor: ${sample.vendor}`);
        if (sample.variants[0]?.sku)
          console.log(`      SKU: ${sample.variants[0].sku}`);
        if (sample.variants[0]?.price)
          console.log(`      Price: $${sample.variants[0].price}`);
        console.log(
          `      Variants: ${sample.variants.length}, Images: ${sample.images.length}`,
        );
      }
    } catch (err) {
      const duration = Date.now() - start;
      results.push({
        file,
        success: false,
        products: 0,
        variants: 0,
        images: 0,
        blocking: 0,
        warnings: 0,
        mapped: 0,
        unmapped: 0,
        needsReview: 0,
        duration,
        error: (err as Error).message,
      });
      console.log(`  ✗ FAILED: ${(err as Error).message}`);
      console.log(`    Duration: ${duration}ms`);
    }

    console.log();
  }

  // Summary table
  console.log(`${"=".repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`${"=".repeat(70)}`);
  console.log();

  const maxName = Math.max(...results.map((r) => r.file.length), 8);
  const header = [
    "File".padEnd(maxName),
    "Status".padEnd(7),
    "Prods".padStart(6),
    "Vars".padStart(6),
    "Imgs".padStart(6),
    "Map".padStart(4),
    "Unmap".padStart(6),
    "Block".padStart(6),
    "Warn".padStart(6),
    "ms".padStart(6),
  ].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of results) {
    const row = [
      r.file.padEnd(maxName),
      (r.success ? "  ✓  " : "  ✗  ").padEnd(7),
      String(r.products).padStart(6),
      String(r.variants).padStart(6),
      String(r.images).padStart(6),
      String(r.mapped).padStart(4),
      String(r.unmapped).padStart(6),
      String(r.blocking).padStart(6),
      String(r.warnings).padStart(6),
      String(r.duration).padStart(6),
    ].join(" | ");
    console.log(row);
  }

  const totalProducts = results.reduce((s, r) => s + r.products, 0);
  const totalSuccess = results.filter((r) => r.success).length;
  console.log();
  console.log(
    `${totalSuccess}/${results.length} files processed successfully, ${totalProducts} total products extracted`,
  );
  console.log();
}

main().catch(console.error);
