What was added/changed:

Change	Files
S3 storage	
file-storage.ts
 — full S3FileStorage class using @aws-sdk/client-s3, supports custom endpoints (Railway Object Storage), signed URL presigning
Build pipeline	tsconfig.server.json — server-only compile excluding web/tests; tsc-alias resolves @shared/@engine/@server paths in output; build script: build:server → build:client → db:generate
Dev mode	vite.config.ts — React plugin + proxy for /api, /auth, /billing, /webhooks to :3000; npm run dev runs tsx watch + vite dev concurrently
Railway config	nixpacks.toml, railway.toml, Procfile — builds with Node 20, runs prisma migrate deploy at startup, health check at /api/health with DB connectivity check
Location query	writer.ts — getPrimaryLocationId() queries the shop's real location via GraphQL, cached per import
Webhook registration	webhooks.ts — registers APP_UNINSTALLED + 3 compliance webhooks after OAuth callback, idempotent
Production serving	Server binds 0.0.0.0, SPA fallback excludes API/auth/webhook routes
To deploy on Railway:

Push to a git repo (GitHub, GitLab, etc.)
In Railway, create a new project → "Deploy from GitHub repo"
Add a PostgreSQL service (Railway's built-in Postgres plugin)
Set these env vars on the web service:

NODE_ENV=production
DATABASE_URL=<auto-set by Railway Postgres plugin>
SHOPIFY_API_KEY=<from Partners Dashboard>
SHOPIFY_API_SECRET=<from Partners Dashboard>
SHOPIFY_APP_URL=https://<your-railway-domain>.up.railway.app
SHOPIFY_SCOPES=write_products,read_products
STORAGE_DRIVER=local
PORT=3000
Railway auto-detects nixpacks.toml, builds, runs migrations, starts the server
Set your Railway public domain as the App URL + redirect URL in Shopify Partners Dashboard
Install on your dev store: https://<railway-domain>/auth?shop=your-store.myshopify.com
If you want S3 for file storage instead of local disk (recommended for production since Railway's filesystem is ephemeral), add a Railway Object Storage volume or use AWS S3 and set STORAGE_DRIVER=s3 + the S3 env vars.