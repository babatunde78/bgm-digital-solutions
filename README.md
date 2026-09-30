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
