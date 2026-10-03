# BGM Secure Delivery — deployment steps

## Current activation state
Only **500 ChatGPT Prompts for Business Owners** is payment-enabled because its private buyer ZIP has been uploaded and mapped as:
`PREMIUM_Buyer_Package_With_EPUB.zip`

The other four guides and the bundle are displayed with their prices but checkout remains disabled until their buyer files are uploaded and mapped. This prevents selling a product that cannot yet be delivered automatically.

## 1. Vercel environment variables
In Vercel → bgm-digital-solutions → Settings → Environment Variables, configure:

- `PAYSTACK_SECRET_KEY` — use the Paystack TEST secret key while testing. Never commit it to GitHub.
- `SITE_URL` — `https://bgm-digital-solutions.vercel.app`
- `DELIVERY_SECRET` — a new random secret of at least 32 characters used only to sign short-lived BGM download tokens. Generate it locally; do not post it publicly.

Your connected private Blob store supplies `BLOB_STORE_ID` and OIDC credentials automatically on Vercel. Do not hard-code the temporary signed Blob URL copied from the dashboard.

After adding/changing environment variables, redeploy.

## 2. Paystack webhook
Set the webhook endpoint to:
`https://bgm-digital-solutions.vercel.app/api/paystack-webhook`

## 3. Test mode first
Use Paystack Test Mode and test keys. Open the store, buy only the 500-prompts product, complete a test payment, and confirm that the callback page says “Your purchase is ready”. Click the download button and confirm that the private ZIP downloads.

Also test an invalid reference and an expired download link. A download token lasts 10 minutes.

## 4. Security design
- Product prices are controlled in `api/_products.js`, not the browser.
- Product identity is stored in Paystack transaction metadata.
- `verify-payment.js` checks Paystack status, product, amount and currency server-side.
- The browser never receives a permanent private Blob URL.
- `download.js` validates a short-lived signed token, re-verifies the Paystack transaction, checks product/email, then streams the private Blob using `@vercel/blob`.
- Paid files must never be committed to GitHub/public folders.

## 5. Activating the remaining products
Upload each buyer package to the same private Blob store. Copy only its pathname (not a temporary signed URL). Then edit `api/_products.js`:
1. add the pathname to `blobPathnames`,
2. set `deliveryReady: true`,
3. set `enabled: true`.
Then set `paymentEnabled:true` for the matching item in `products.js` and redeploy.

For the bundle, add all five buyer-package pathnames. The current download endpoint streams the first file only, so extend it to offer multiple authorized download buttons before enabling the bundle.

## 6. Going live
Only after successful end-to-end test payments should you replace the test Paystack secret with the live secret, redeploy, and make a small real purchase yourself. Confirm the amount, buyer email, Paystack transaction, callback and private download before promoting the store.
