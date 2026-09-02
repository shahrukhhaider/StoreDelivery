# StoreKeeper

Shopify app that converts supplier CSV/XLSX catalogs into new product listings through a safe, review-first workflow.

Upload a supplier spreadsheet → review auto-detected column mappings → preview products → import to Shopify.

## Features

- **CSV & XLSX parsing** — comma, tab, semicolon delimiters, European number formats, UTF-8/BOM, multi-sheet workbooks
- **Smart column detection** — 100+ header aliases map supplier columns to Shopify fields automatically
- **Type inference** — detects currency, barcode, URL, integer, boolean, and category columns from sample values
- **Product/variant grouping** — groups flat rows into products with variants by parent key, shared title, or SKU prefix
- **Validation** — catches missing titles, duplicate SKUs, malformed prices, suspicious values before import
- **Duplicate detection** — checks existing store products by SKU and barcode to prevent duplicates
- **Batch import** — bounded concurrency with Shopify rate-limit handling, retry on transient errors
- **Resumable** — partial failures are recoverable; retry only failed items without re-importing everything
- **Image support** — attaches product images from supplier URLs; image failures don't block product creation
- **Shopify billing** — App Store subscription management with free trial support
- **Compliance** — mandatory Shopify webhooks (data request, customer redact, shop redact), encrypted tokens at rest

## Architecture

```
src/
├── engine/          # Pure logic — no DB, no HTTP, no Shopify
│   ├── parser/      # CSV + XLSX parsing, delimiter detection, fingerprinting
│   ├── mapping/     # Header aliases, type inference, mapping engine
│   ├── grouping/    # Product/variant grouping strategies
│   ├── normalizer/  # Price, weight, tags, text normalization
│   ├── validation/  # Blocking/warning/info issue detection
│   └── pipeline.ts  # End-to-end: parse → map → group → validate → Catalog
├── server/          # Express API + Shopify integration
│   ├── api/         # REST endpoints: uploads, catalogs, mappings, imports
│   ├── shopify/     # OAuth, GraphQL client, writer, billing, compliance, webhooks
│   ├── jobs/        # Background worker (parse), import executor (write)
│   └── storage/     # File storage (local dev + S3 production)
├── shared/          # Types, constants, errors
└── web/             # React + Shopify Polaris embedded UI
    └── pages/       # Upload, Mapping, Preview, Results, History, Welcome
```

The engine is intentionally independent of Shopify — the parser and canonical model can support non-Shopify targets in the future.

## Prerequisites

- Node.js >= 20
- PostgreSQL
- A [Shopify Partner](https://partners.shopify.com) account with an app + development store

## Local Development

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Fill in DATABASE_URL, SHOPIFY_API_KEY, SHOPIFY_API_SECRET, etc.

# Create database tables
npx prisma migrate dev

# Start dev server (Express + Vite with hot reload)
npm run dev
```

The Vite dev server runs on `:5173` and proxies `/api`, `/auth`, `/billing`, `/webhooks` to the Express server on `:3000`.

For Shopify OAuth you need a public URL. Use ngrok or Cloudflare Tunnel:

```bash
ngrok http 3000
```

Then set `SHOPIFY_APP_URL` to your tunnel URL and update the redirect URL in your Shopify Partner Dashboard.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Start Express + Vite dev servers concurrently |
| `npm run build` | Compile server (tsc) + bundle client (Vite) + generate Prisma |
| `npm start` | Run production server from `dist/` |
| `npm test` | Run all tests (vitest) |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint with ESLint |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:studio` | Open Prisma Studio GUI |

## Testing

133 tests covering the engine layer:

```bash
npm test
```

Test fixtures in `test/fixtures/` cover simple catalogs, variant rows, duplicate SKUs, European prices, tab-delimited, BOM encoding, bad headers, and a 500-row performance baseline.

## Deploy to Railway

1. Push to GitHub
2. Create a Railway project → **Deploy from GitHub repo**
3. Add a **PostgreSQL** service (Railway plugin)
4. Set environment variables:

```
NODE_ENV=production
DATABASE_URL=<auto-set by Railway Postgres>
SHOPIFY_API_KEY=<from Partners Dashboard>
SHOPIFY_API_SECRET=<from Partners Dashboard>
SHOPIFY_APP_URL=https://<your-railway-domain>.up.railway.app
SHOPIFY_SCOPES=write_products,read_products
STORAGE_DRIVER=local
PORT=3000
```

5. Railway auto-detects `nixpacks.toml`, builds, runs migrations, starts the server
6. Set the Railway domain as the App URL + allowed redirect URL in Shopify Partners Dashboard
7. Install on your dev store: `https://<railway-domain>/auth?shop=your-store.myshopify.com`

For production file storage, set `STORAGE_DRIVER=s3` and configure the S3 environment variables (see `.env.example`). Railway's local filesystem is ephemeral across deploys.

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SHOPIFY_API_KEY` | Yes | Shopify app client ID |
| `SHOPIFY_API_SECRET` | Yes | Shopify app client secret |
| `SHOPIFY_APP_URL` | Yes | Public URL of the app |
| `STORAGE_DRIVER` | No | `local` (default) or `s3` |
| `PORT` | No | Server port (default: 3000) |

## Extension Points

The V0 data model is designed to support future additions without replacing the core:

- **V1** — Supplier profiles, saved mappings, transformation rules
- **V2** — Catalog reconciliation, diff engine, change sets
- **V3** — Rollback, scheduled sync, feed connections

## License

Proprietary. See [LICENSE](LICENSE) for details.
