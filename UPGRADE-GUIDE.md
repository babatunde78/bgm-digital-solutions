# BGM Digital Solutions — Latest GitHub ZIP Upgrade

This package was built from the user's newly uploaded `bgm-digital-solutions-main (1).zip`. It preserves the existing static catalogue as a fallback and the existing payment/delivery endpoints. It has NOT been deployed or tested with live credentials.

## 1. Test on a Vercel preview deployment first

Keep the current production website untouched until a preview passes. Back up your GitHub repository and Vercel environment settings. Do not expose credentials in GitHub or chat.

## 2. Create Supabase database

Create your own Supabase project, open SQL Editor, run `supabase-schema.sql`. Copy Project URL and service-role key to **Vercel server-side environment variables**:

- `SUPABASE_URL` — project URL
- `SUPABASE_SERVICE_ROLE_KEY` — secret server-side key; NEVER put in HTML, JS or public variables
- `BGM_ADMIN_SECRET` — randomly generated secret of at least 32 characters; keep private

Keep existing `PAYSTACK_SECRET_KEY`, `SITE_URL`, `BLOB_READ_WRITE_TOKEN`, and delivery-token secret unchanged. Configure these in Vercel for preview and production as appropriate. Never mix Paystack test and live credentials.

## 3. Open `/admin.html`

Enter your administrator secret (not saved to browser storage), add products as **drafts**, or download the JSON template and import any number of products in batches. Add marketplace URLs only from official product pages. For existing products, the original server-side catalogue remains available as a fallback; the new database record takes precedence if the same ID exists.

The storefront fetches published database records at `/api/catalog`, merged with legacy `products.js`. Legacy products are not automatically migrated or disabled. Before migrating an existing product, use its **exact existing ID**, preserve prices and download paths, and test carefully. A production migration should explicitly retire the legacy catalogue once all records are verified.

## 4. Important current limitations

- The admin uses a long-lived shared secret, not per-user MFA or session-based authentication. Restrict admin access and replace with managed MFA before broad multi-admin use.
- File upload to private Vercel Blob is **not implemented in the admin**. Upload in Vercel Blob and enter exact pathnames; verify files exist and download correctly.
- CSV/Excel import is not implemented; **JSON bulk import** is implemented, with batches of 100.
- Marketplace integrations are **external purchase links**, not account connections or sales synchronization.
- Product status and database existence do not prove payment processing or international payment eligibility.
- No automated transactional email, refund automation, tax engine, or recurring subscriptions yet.
- Do not set `delivery_ready=true` unless the private file exists and full Paystack test-mode payment/verification/download has passed.
- Existing legacy products can still show Buy Now even if their Blob packages are missing; audit these before production.

## 5. Acceptance checklist

1. Node syntax check passes on all JavaScript files.
2. Vercel preview deploy is Ready; `/api/catalog` responds.
3. Admin secret rejects incorrect values; correct secret can save a draft.
4. Bulk JSON import saves multiple products and retains their status.
5. Published products appear on storefront; draft products do not.
6. Marketplace buttons lead to correct official HTTPS listings.
7. Test-mode Paystack initialization, payment verification and ZIP downloads succeed.
8. Existing seven paid products and the payroll service are not regressed.
9. Mobile layout, accessibility, terms/privacy/refund pages are reviewed.
10. Backups, monitoring, rollback and incident procedures are documented.
