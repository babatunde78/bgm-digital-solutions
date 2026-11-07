# BGM repository integration

Read only the sections needed for the current work. Paths below are relative to the repository root.

## Sources and invariants

- `README.md`: architecture, current delivery settings, run/check commands, product imports, operator recovery.
- `SECURE-DELIVERY-DEPLOY.md`, especially sections 2, 5, and 6: environment separation, private assets, publication fields, provider acceptance.
- `lib/catalog.js` and `api/catalog.js`: public catalogue response consumed by `catalog-loader.js` and `app.js`.
- `lib/product-import.json` and `lib/product-import.js`: operator import definitions and preservation rules. These are not the live purchase-price authority.
- `supabase/migrations/`: inspect the actual schema before suggesting fields or migrations.
- `app.js`: product artwork/audience presentation mapping and USD reference amounts; filters, details, checkout.
- `product.html`: persistent product destination, `product.html?id=<stable-product-id>`.
- `scripts/build.js` and `scripts/dev.js`: explicit allowlists for new pages/scripts/images.
- `sitemap.xml`: published destinations. Do not list private buyer files or drafts.

Supabase controls published products and charged amounts. Payment values are integer currency subunits, not display strings. Keep the same stable ID through import metadata, UI presentation, URLs, and order/delivery mapping.

Display owner-supplied USD references beside NGN with clear reference wording; these do not enable dollar checkout or guarantee the issuer's conversion. Only show currencies offered by the public catalogue in checkout. Never change Paystack currency settings merely to match display copy.

Do not assume the current reader accepts new media, licence, preview, or compatibility fields. Inspect first; use supported presentation metadata or propose a reviewed schema change when necessary.

## Buyer file handling

The build copies approved browser assets into `public/`. Paid documents, editable sources, ZIPs, customer data, and credentials must stay outside that allowlist. `.product-work/` is ignored; verify the actual ignore behavior before creating buyer files.

Private Blob pathnames must identify real, nonempty files. Use immutable versioned paths, such as `<slug>/v1/buyer-package.zip`. Never overwrite an asset referenced by a paid order. Orders snapshot their purchased price, title, and asset paths; existing paid-order access must survive a new edition.

New import rows can be prepared as drafts. Existing import operations preserve prior prices and draft decisions; editing the JSON is not proof that live values changed. Unknown files or IDs need an intentional mapping, not automatic publication.

## Visual and copy integration

Current optimized mockups are JPEG files under `assets/`. Match their style rather than using a universal identical cover. Record the selected generated asset paths and prompts in the delivery report or maintained asset provenance when requested.

Use the finished product as the source for content claims. Do not infer PDF/EPUB format, page counts, compatibility, worksheet count, or support rights from a ZIP filename or a mockup. Ensure bundle contents and savings use the actual included published products and current prices.

Enquiry-only deployments are services: their proposal terms are separate from downloadable-product delivery/refund wording. Never put service enquiries into a digital purchase flow.

## Validation and release

Run narrow frontend/catalogue tests first, then `npm run check`, `npm test`, and `npm run build` for an integrated storefront change. On PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

Use the existing development server. Without credentials, `npm run dev -- --preview-catalogue` reads the public catalogue for a read-only preview; it disables purchase buttons and rejects payment initialization. This does not test payment acceptance or private delivery.

Verify the individual URL, search/filter behavior, price/reference separation, mobile/keyboard use, image delivery, and build allowlists. Use configured test-mode provider acceptance for payment/delivery changes; synthetic integration tests do not prove live acceptance.

This repository has two Git-linked Vercel projects. Verify which project owns `www.bgmsolutions.site` before releasing; never select a target by name similarity alone. Preserve Preview/test versus Production/live settings and paused-email decisions unless explicitly changed by the owner. Follow current credentials and authorizations, not assumptions saved in this reference.
