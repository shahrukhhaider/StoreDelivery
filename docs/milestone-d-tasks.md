# Milestone D — Publication Hardening

**Goal:** Polish, compliance, observability, and App Store submission readiness.
**Exit criteria:** Shopify review submission.

---

## Task D1: Shopify Billing Integration

**File:** `src/server/shopify/billing.ts`

- [ ] D1.1 — Recurring charge creation via GraphQL `appSubscriptionCreate`
- [ ] D1.2 — Billing confirmation callback
- [ ] D1.3 — Billing status check middleware (gate features behind active subscription)
- [ ] D1.4 — Free trial / free tier support
- [ ] D1.5 — Config toggle: `BILLING_ENABLED=true/false`

---

## Task D2: Compliance Webhooks & Data Lifecycle

**File:** `src/server/shopify/compliance.ts`
**Spec:** Sections 18, 19

- [ ] D2.1 — `customers/data_request` webhook handler
- [ ] D2.2 — `customers/redact` webhook handler
- [ ] D2.3 — `shop/redact` webhook handler — delete all shop data
- [ ] D2.4 — Data cleanup on uninstall (tokens, uploads, catalogs)
- [ ] D2.5 — File storage cleanup (delete raw files for uninstalled shops)

---

## Task D3: Observability & Metrics

**File:** `src/server/observability.ts`
**Spec:** Section 21

- [ ] D3.1 — Structured metrics: upload success/failure, parse duration, mapping confidence distribution
- [ ] D3.2 — Import metrics: mutation failure rate, rate-limit events, completion rate
- [ ] D3.3 — Operation ID in all log entries
- [ ] D3.4 — Sensitive data redaction in logs (no raw file content, no tokens)
- [ ] D3.5 — Health check enhanced: DB connectivity, storage reachable

---

## Task D4: Security Hardening

**Spec:** Section 19

- [ ] D4.1 — CSRF protection on state-changing endpoints
- [ ] D4.2 — Helmet middleware (security headers)
- [ ] D4.3 — Rate limiting on upload endpoint
- [ ] D4.4 — Input sanitization: escape formula-like values (=, +, -, @) in exported data
- [ ] D4.5 — Tenant isolation audit: ensure all queries filter by shopId
- [ ] D4.6 — Webhook HMAC verification with raw body

---

## Task D5: Polished Onboarding & UI

**Spec:** Section 23

- [ ] D5.1 — Welcome/onboarding screen for first-time users
- [ ] D5.2 — Empty states with clear CTAs
- [ ] D5.3 — Error messages are human-readable (no stack traces)
- [ ] D5.4 — Loading skeletons for all data-fetching pages
- [ ] D5.5 — History page: real data from import_operations table
- [ ] D5.6 — Export error report (CSV download of failed items)

---

## Task D6: Legal & Support Pages

- [ ] D6.1 — Privacy policy page/route
- [ ] D6.2 — Terms of service page/route
- [ ] D6.3 — Support contact visible in app
- [ ] D6.4 — Support URL in Shopify app listing config

---

## Task D7: App Store Listing Assets

- [ ] D7.1 — App listing copy (name, tagline, description)
- [ ] D7.2 — Review instructions document
- [ ] D7.3 — `shopify.app.toml` configuration file
- [ ] D7.4 — Production callback URLs configuration

---

## Task D8: Final Testing & Verification

- [ ] D8.1 — Full flow test: install → upload → map → preview → import → results → uninstall
- [ ] D8.2 — Cross-shop isolation test
- [ ] D8.3 — Billing flow test (if enabled)
- [ ] D8.4 — Compliance webhook test
- [ ] D8.5 — `npm run build` succeeds
- [ ] D8.6 — `npm test` passes
- [ ] D8.7 — V0 Definition of Done checklist verified

---

## Milestone D Exit Criteria

- [ ] All 12 items from Section 26 "V0 Definition of Done" are satisfied
- [ ] All items from Section 23 "Publishability Checklist" are addressed
- [ ] Shopify review submission ready
