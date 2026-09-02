# StoreKeeper — Shopify App Review Instructions

## Prerequisites

- A Shopify development store (or use the provided test store credentials)
- No special setup required — the app works out of the box after install

## Installation

1. Click "Install" from the app listing
2. Approve the requested scopes: `write_products`, `read_products`
3. You'll be redirected to the app's welcome screen

## Testing the core flow

### Step 1: Upload a catalog file

Use one of the included test files, or upload any CSV/XLSX with product data.

**Test file (simple.csv):**
```
SKU,Product Name,Description,Brand,Price,Quantity,Image URL
TEST-001,Blue Widget,A test widget,TestBrand,24.99,10,https://via.placeholder.com/400
TEST-002,Red Gadget,A test gadget,TestBrand,19.99,25,https://via.placeholder.com/400
```

1. Click "Upload your first catalog"
2. Drop or select the CSV file
3. Wait for parsing (a few seconds)

### Step 2: Review mappings

1. The mapping review screen shows detected columns
2. Verify columns are mapped correctly (SKU → SKU, Product Name → Product Title, etc.)
3. High-confidence mappings are shown in green
4. Click "Save & Preview"

### Step 3: Preview products

1. Review the product table (title, vendor, SKU, price, variants, images)
2. Check the summary banner for issue counts
3. Click "Create Import Plan"

### Step 4: Confirm and import

1. Review the import plan (X products, Y variants, Z images)
2. Click "Start Import"
3. Watch real-time progress
4. Review results: created / failed / skipped

### Step 5: Verify in Shopify

1. Go to Products in your Shopify admin
2. Confirm the imported products appear with correct data

## Uninstall

1. Go to Settings → Apps in your Shopify admin
2. Click "Delete" next to StoreKeeper
3. All app data is deleted within 48 hours

## Known limitations (V0)

- Only creates new products (no updates/sync)
- No scheduled/automated imports
- No supplier API connections
- Image URLs must be publicly accessible

## Support

support@storekeeper.app
