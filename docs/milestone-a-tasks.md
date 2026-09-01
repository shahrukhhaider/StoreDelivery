# Milestone A — Offline Engine

**Goal:** CSV/XLSX parser, canonical model, mapping, validation, golden fixtures.
**Exit criteria:** 10+ different catalog schemas normalized correctly.

---

## Task A1: CSV Parser

**File:** `src/engine/parser/csv-parser.ts`
**Spec:** Section 7

Implement `parseCsv()` and `detectDelimiter()`:

- [ ] A1.1 — Delimiter detection: sample first 10 lines, score comma/tab/semicolon by consistency
- [ ] A1.2 — UTF-8 BOM stripping
- [ ] A1.3 — Parse using `csv-parse` with detected delimiter, quoted fields, embedded newlines
- [ ] A1.4 — Whitespace normalization on headers and cell values
- [ ] A1.5 — Reject binary data (check for null bytes in first 1KB)
- [ ] A1.6 — Reject empty files and files above `MAX_UPLOAD_SIZE_BYTES`
- [ ] A1.7 — Return `ParsedSheet` with headers, rows (as `Record<string, string>[]`), delimiter, rowCount
- [ ] A1.8 — Unit tests: comma, tab, semicolon, BOM, quoted fields, embedded newlines, empty, binary, oversized

---

## Task A2: XLSX Parser

**File:** `src/engine/parser/xlsx-parser.ts`
**Spec:** Section 7

Implement `listSheets()` and `parseXlsx()`:

- [ ] A2.1 — List sheets in workbook with row counts using `exceljs`
- [ ] A2.2 — Detect which sheets contain tabular data (have a header-like first row)
- [ ] A2.3 — Parse selected sheet into `ParsedSheet` format (displayed values, not formulas)
- [ ] A2.4 — If multiple candidate sheets and no sheet specified, throw descriptive error requiring selection
- [ ] A2.5 — Whitespace normalization consistent with CSV parser
- [ ] A2.6 — Reject oversized files
- [ ] A2.7 — Unit tests: single-sheet, multi-sheet, formula cells, empty sheet, oversized

---

## Task A3: Value Normalizer

**File:** `src/engine/normalizer/normalizer.ts`
**Spec:** Implicit from Sections 8, 10

- [ ] A3.1 — `normalizePrice()`: strip currency symbols (`$`, `€`, `£`, etc.), handle comma-as-thousands (`1,234.56`), handle European format (`1.234,56`), return decimal string or null
- [ ] A3.2 — `normalizeInteger()`: strip non-numeric, parse int, return number or null
- [ ] A3.3 — `normalizeWeight()`: extract numeric + unit (`"2.5 lbs"` → `{value: 2.5, unit: "lb"}`), normalize unit names
- [ ] A3.4 — `normalizeTags()`: split on comma/semicolon/pipe, trim each, deduplicate
- [ ] A3.5 — `normalizeText()`: trim, collapse whitespace, strip control chars
- [ ] A3.6 — Unit tests: US prices, EU prices, edge cases (empty, "N/A", "TBD"), weights with/without units, tags with mixed delimiters

---

## Task A4: Header Alias Mapping (Deterministic)

**File:** `src/engine/mapping/aliases.ts`
**Spec:** Section 8.1

- [ ] A4.1 — `normalizeHeader()` is already implemented; verify it handles unicode, diacritics, extra punctuation
- [ ] A4.2 — Expand alias dictionary: audit against 5+ real supplier catalogs if available, add missing common headers
- [ ] A4.3 — Handle numbered variants: `"image 2"`, `"image 3"` → `image.url` (with position)
- [ ] A4.4 — Handle option columns with values in header: `"Color"`, `"Size"` → `variant.option1`, `variant.option2` (positional)
- [ ] A4.5 — Unit tests: exact match, case-insensitive, extra whitespace, unknown header returns null

---

## Task A5: Column Type Inference

**File:** `src/engine/mapping/type-inference.ts`
**Spec:** Section 8.2

- [ ] A5.1 — Currency detection: regex for `$12.99`, `€12,99`, bare decimals with 2 places
- [ ] A5.2 — Integer detection: whole numbers, possibly with thousand separators
- [ ] A5.3 — URL detection: `http://` / `https://` prefix
- [ ] A5.4 — Barcode detection: 8/12/13 digit numeric strings (EAN-8, UPC-A, EAN-13)
- [ ] A5.5 — Boolean detection: yes/no, true/false, 1/0, y/n
- [ ] A5.6 — Calculate match rate (fraction of non-empty values matching the inferred type)
- [ ] A5.7 — Return `"unknown"` if no type reaches a confidence threshold (e.g. 60% match rate)
- [ ] A5.8 — Unit tests: columns of prices, mixed types, barcodes, URLs, booleans, ambiguous data

---

## Task A6: Mapping Engine Orchestrator

**File:** `src/engine/mapping/mapping-engine.ts`
**Spec:** Section 8

Wire together alias lookup → type inference → confidence assignment:

- [ ] A6.1 — For each header: try alias lookup first. If found with alias, confidence = `"high"`, source = `"rule"`
- [ ] A6.2 — For unmatched headers: run type inference. If type strongly suggests a target (e.g. currency → price, URL → image), assign with confidence = `"medium"`, source = `"rule"`
- [ ] A6.3 — Mark remaining columns as unmapped with confidence = `"low"` (these are candidates for LLM inference in a later step)
- [ ] A6.4 — Detect conflicts: two columns mapped to the same target field → mark both as `"medium"` needing review
- [ ] A6.5 — Return `MappingResult` with mappings, needsReview, unmapped lists
- [ ] A6.6 — Unit tests: simple catalog (all aliases match), mixed catalog, catalog with conflicts, catalog with no recognizable headers

---

## Task A7: Product/Variant Grouping

**File:** `src/engine/grouping/grouping-engine.ts`
**Spec:** Section 9

- [ ] A7.1 — Strategy 1: If a `grouping.parentKey` column is mapped, group rows by that value
- [ ] A7.2 — Strategy 2: If no parent key, check for a variant-indicating column (e.g. `variant.option1` mapped). Group rows sharing the same title
- [ ] A7.3 — Strategy 3: SKU prefix grouping — detect shared prefix patterns (e.g. `SHOE-001-RED`, `SHOE-001-BLU`)
- [ ] A7.4 — Fallback: treat each row as a standalone product with one variant
- [ ] A7.5 — Build `CatalogProduct[]` with proper variant nesting, image attachment, `sourceData` preservation
- [ ] A7.6 — Mark ambiguous groups (shared title but no clear option differentiation) in `ambiguousGroups`
- [ ] A7.7 — Unit tests: parent-key grouping, title+option grouping, SKU prefix, standalone rows, ambiguous cases

---

## Task A8: Validation Engine

**File:** `src/engine/validation/validation-engine.ts`
**Spec:** Section 10

- [ ] A8.1 — Blocking: missing product title
- [ ] A8.2 — Blocking: invalid variant structure (product with zero variants after grouping)
- [ ] A8.3 — Blocking: malformed price (mapped but not parseable after normalization)
- [ ] A8.4 — Blocking: no viable row/product structure (zero products from entire file)
- [ ] A8.5 — Warning: missing SKU
- [ ] A8.6 — Warning: duplicate SKU within the catalog
- [ ] A8.7 — Warning: duplicate barcode within the catalog
- [ ] A8.8 — Warning: unreachable image URL (basic URL syntax check; no HEAD request in offline engine)
- [ ] A8.9 — Warning: suspiciously large price (>$99,999) or small price (<$0.01 where price exists)
- [ ] A8.10 — Warning: empty option value
- [ ] A8.11 — Info: blank rows removed (count)
- [ ] A8.12 — Info: whitespace cleaned (count)
- [ ] A8.13 — Return `ValidationResult` with issue list and summary counts
- [ ] A8.14 — Unit tests: each blocking/warning/info case, clean catalog with zero issues, catalog with all issue types

---

## Task A9: Schema Fingerprinting

**File:** `src/engine/parser/fingerprint.ts` (new)

- [ ] A9.1 — Generate a stable hash from sorted header names + detected delimiter + format
- [ ] A9.2 — Used to match saved mappings for repeat uploads from the same supplier
- [ ] A9.3 — Unit tests: same headers different order → same fingerprint, different headers → different fingerprint

---

## Task A10: End-to-End Pipeline Function

**File:** `src/engine/pipeline.ts` (new)

Wire the full offline pipeline: parse → map → group → normalize → validate → return Catalog:

- [ ] A10.1 — `processCatalog(buffer, options)` → `Catalog` with products and issues
- [ ] A10.2 — Accept optional pre-existing mappings (for re-import with saved/edited mappings)
- [ ] A10.3 — Apply normalizers during the grouping/product-building step
- [ ] A10.4 — Integration test with a complete CSV fixture → verify canonical output matches expected JSON

---

## Task A11: Golden Test Fixtures

**Directory:** `test/fixtures/`
**Spec:** Section 22

Create 10+ fixture files covering distinct schemas:

- [ ] A11.1 — `simple.csv` — basic product list, comma-delimited, standard headers
- [ ] A11.2 — `variants-rows.csv` — parent/child rows with option columns
- [ ] A11.3 — `duplicate-skus.csv` — intentional duplicate SKUs to trigger warnings
- [ ] A11.4 — `european-prices.csv` — semicolon delimiter, comma decimal (`12,99 €`)
- [ ] A11.5 — `image-columns.xlsx` — multiple image URL columns
- [ ] A11.6 — `bad-headers.csv` — unrecognizable headers, requires LLM/manual mapping
- [ ] A11.7 — `parent-child.xlsx` — explicit parent ID grouping column
- [ ] A11.8 — `weird-encoding.csv` — UTF-8 BOM, special characters, accented names
- [ ] A11.9 — `tab-delimited.csv` — TSV format
- [ ] A11.10 — `large-catalog.csv` — 500+ rows for performance baseline
- [ ] A11.11 — Expected output JSON for each fixture (stored alongside as `simple.expected.json`, etc.)

---

## Milestone A Exit Criteria

- [ ] All 10+ fixtures parse without errors
- [ ] Each fixture's canonical output matches its expected JSON
- [ ] `vitest run` passes with all engine tests green
- [ ] `tsc --noEmit` passes clean
- [ ] No placeholder `throw new Error("Not implemented")` remains in engine modules
