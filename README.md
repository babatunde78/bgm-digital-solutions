# BGM Digital Solutions Storefront

A lightweight, responsive digital-product storefront designed for deployment on Vercel, GitHub Pages or any static web host.

## What is included
- Responsive business website
- Product catalogue
- Product search and category filtering
- Product detail modal
- Per-product checkout links
- Selar/Gumroad/payment-provider independent checkout architecture
- Services, About, FAQ and Contact sections
- GitHub and LinkedIn business-proof links
- Mobile navigation
- Basic SEO metadata
- No card/payment credentials stored in the website

## IMPORTANT before launch
The sample products are based on current projects and are marked Coming Soon unless a checkout URL exists. Do not claim a product is purchasable until you have created its actual product page and uploaded the deliverable to your checkout platform.

## Add a product
Open `products.js`. Copy an existing product object and edit:
- `id`: unique short slug
- `name`
- `category`
- `price`
- `short`
- `description`
- `features`
- `checkoutUrl`: paste the full Selar or Gumroad product checkout link
- `status`: use `live`, `coming-soon`, or `service`

Example:
```js
{id:"my-ebook", name:"My Ebook", category:"Ebooks", price:"$15", short:"Short description", description:"Full description", features:["PDF","Bonus worksheet"], checkoutUrl:"PASTE_CHECKOUT_URL_HERE", status:"live"}
```

## Recommended payment/delivery setup
For the fastest first launch, create each digital product on Selar (or Gumroad), upload its files there, configure price/currency/refund terms, and paste that product's checkout link into `products.js`. The website becomes your branded catalogue; the provider handles payment and digital delivery.

Do NOT collect raw card details in this static website. If you later want native checkout, migrate to a server-backed implementation with a payment provider and verified webhooks.

## Deploy with GitHub + Vercel
1. Create a new GitHub repository, e.g. `bgm-digital-solutions`.
2. Put all files from this folder in the repository root.
3. Commit and push to `main`.
4. Sign in to Vercel and choose Add New > Project.
5. Import the GitHub repository.
6. For a static site, no build command is required. Deploy.
7. Vercel will provide a public URL. Test every navigation link and every live Buy Now button.
8. Add a custom domain later if desired.

## Sales/admin controls to keep outside the public website
Use your payment platform dashboard for product-file access, orders, refunds, coupons, buyer email, payout settings, tax settings where applicable, and sales reporting. Use GitHub to control website/product catalogue changes.

## Pre-launch checklist
- Replace every `Add price`
- Create checkout pages for products actually for sale
- Paste checkout URLs into `products.js`
- Upload final product files to the checkout provider
- Confirm product title, price, currency, cover and description
- Add a clear refund policy appropriate to each product
- Add Privacy Policy and Terms pages before collecting marketing data directly
- Test checkout with the provider's supported test/low-risk method
- Test on phone and desktop
- Confirm `badmurs0@gmail.com` is monitored
- Confirm GitHub and LinkedIn links
- Consider a custom domain and domain-based email

## Security
Never put payment secret keys, API keys, passwords, private download URLs, or customer data into `products.js`, HTML, GitHub, or other public frontend files.

## Paystack secure payment upgrade

This version includes Vercel serverless endpoints:
- `POST /api/initialize-payment` — initializes payment from the server.
- `GET /api/verify-payment?reference=...` — verifies status, currency and authoritative server-side amount.
- `POST /api/paystack-webhook` — validates Paystack's HMAC-SHA512 signature before processing successful charges.

### 1. Configure Vercel environment variables
In Vercel: Project → Settings → Environment Variables.
Add:
- `PAYSTACK_SECRET_KEY` = your Paystack TEST secret key first (`sk_test_...`). Never commit this value to GitHub.
- `SITE_URL` = `https://bgm-digital-solutions.vercel.app`
Apply them to Production (and Preview if you want branch testing), then redeploy.

### 2. Configure products and prices
Edit `api/_products.js`. Amounts are in kobo: NGN 5,000 = `500000`. Set a real amount and `enabled: true` only when the product is ready.
Edit the matching item in `products.js`: set its display price and `paymentEnabled:true`.
The browser's displayed price is not trusted for charging; the backend catalogue is authoritative.

### 3. Paystack dashboard
While testing, remain in Paystack Test Mode. In API Keys & Webhooks set the webhook URL to:
`https://bgm-digital-solutions.vercel.app/api/paystack-webhook`
The callback URL is supplied programmatically as:
`https://bgm-digital-solutions.vercel.app/payment-success.html`

### 4. Test before going live
Use Paystack test keys/test payment methods. Confirm successful, failed and abandoned flows. Confirm that a modified browser price cannot change the server-side amount. Confirm the callback verifies the reference. Check Vercel function logs for webhook requests.

### 5. Digital delivery
The code deliberately does NOT expose permanent product download links. Before selling downloadable files, add durable storage/database + idempotent fulfillment (a unique transaction reference) and send an expiring/signed download link or use a fulfillment provider. This prevents duplicate fulfillment and casual sharing of private file URLs.

### 6. Live launch
Only after tests pass, replace the Vercel `PAYSTACK_SECRET_KEY` with your LIVE secret key, redeploy, and make a small real transaction. Do not place either test or live secret keys in GitHub, HTML, `products.js`, screenshots, chat messages, or public documentation.

## 2026 secure private-delivery upgrade
See `SECURE-DELIVERY-DEPLOY.md`. This version uses Paystack for payment and a connected Vercel Private Blob store for BGM-controlled delivery. Only the 500-prompts product is enabled until the remaining private buyer files are uploaded and mapped.
