# BGM Digital Solutions: UX and conversion upgrade plan

Audit date: 7 November 2026. Scope: public storefront, live catalogue, purchase-support experience, frontend implementation, and relevant project documentation.

## 1. Executive recommendation

BGM needs clearer routes to its offers, stronger evidence of product value, and more confidence around purchase access. A cosmetic refresh alone would leave these problems unresolved. Keep the existing brand palette and lightweight architecture, then improve the content hierarchy and buying journey in stages.

The proposed conversion strategy is to help each visitor answer four questions: Is this for me? What exactly will I get? Why should I trust it? What happens after I pay?

This is a heuristic audit, not a measured explanation of current abandonment. No conversion baseline or customer interviews were available, so expected benefits below are hypotheses, not promised revenue increases.

## 2. Evidence and inspection limits

Successfully fetched the live homepage, `/api/catalog`, `/api/store-status`, deployed CSS, catalogue loader, application JavaScript, purchase-support HTML, and purchase JavaScript. Compared these with local source, README, deployment guide, catalogue definitions, build script, and security configuration.

The live catalogue returned seven purchasable products, all with NGN pricing. The live store-status endpoint returned `emailEnabled: false`. Catalogue availability flags do not establish successful payment or download delivery.

The browser access host was unavailable. No rendered desktop or mobile screenshots, browser interaction tests, screen-reader session, Lighthouse results, or real payment were obtained. Layout concerns are inferred from deployed HTML/CSS and require visual validation. No production checkout was initiated, customer data accessed, or external messages sent.

Public evidence: [storefront](https://www.bgmsolutions.site/), [catalogue](https://www.bgmsolutions.site/api/catalog), [delivery settings](https://www.bgmsolutions.site/api/store-status), [purchase support](https://www.bgmsolutions.site/payment-success.html).

## 3. What the business offers

There are three distinct customer journeys under one brand:

| Journey | Current offers | Buyer decision | Desired conversion |
| --- | --- | --- | --- |
| Practical learning resources | Business prompts, AI side hustles, remote jobs, Upwork, scholarships, five-guide bundle | Is the material useful, credible, and suitable for my level? | Verified paid order followed by successful file access |
| Specialist business software | University collections-to-bank Excel evidence toolkit | Does this fit our records, software, and reconciliation process? | Purchase or qualified product enquiry |
| Custom services | Document automation, data solutions, business tools, training; enquiry-only payroll solution | Can BGM solve my workflow problem, and what will delivery involve? | Qualified enquiry, then proposal and won project |

Live individual prices were ₦7,500 for business prompts; ₦12,000 each for AI side hustles and scholarships; ₦10,000 each for remote jobs and Upwork; ₦35,000 for the bundle; and ₦54,900 for the university toolkit. These are an audit snapshot; the live database remains authoritative.

Do not choose the homepage's dominant commercial audience solely from catalogue order or product price. Confirm traffic sources, sales, margins, service capacity, and business priorities first. Until then, use a balanced homepage with explicit audience routes, plus focused landing pages for campaigns.

## 4. What already works

- The visual foundation is coherent in source: green, ink, off-white, restrained borders, and consistent card styles.
- Checkout asks for little information and does not require account creation.
- Search, category filtering, responsive breakpoints, visible focus styling, modal Escape handling, and focus trapping already exist.
- WhatsApp and email support are easy to find; purchase-pending copy correctly discourages paying twice.
- Server-controlled catalogue availability and private delivery are useful foundations. Preserve their guarantees during UI work.

## 5. Prioritized findings

Priority reflects likely impact and dependency, not measured conversion loss. Effort is relative: S = focused copy/UI change; M = several related components; L = multiple pages or integration work.

| Priority | Finding and evidence | Proposed improvement | Effort / validation |
| --- | --- | --- | --- |
| P0 | Hero says “Smart Automation. Better Business.” while the catalogue includes career and scholarship guides. The right-hand panel reinforces services rather than showing the breadth of available offers. | State the broader offer clearly and give visitors separate routes to guides, business tools, and custom services. | M; test comprehension with representative visitors |
| P0 | Product details provide a short description and feature list, without actual sample pages, screenshots, compatibility, detailed contents, or licence information. | Create a repeatable product-detail structure with evidence and purchase requirements. | L; visitors can determine fit without contacting support |
| P0 | Refund FAQ refers to a policy displayed at checkout, but no specific BGM policy is linked in the storefront or first-party checkout markup. Hosted checkout terms were not inspected. | Owner defines refund/support terms; publish and link them before payment. | S/M; no circular references or undefined promises |
| P0 | Email is disabled, yet purchase timeout text suggests email recovery, and the no-reference state mentions a form that can remain hidden. | Make every purchase/recovery state consistent with actual store capabilities. State download and cross-device support expectations before payment. | S; test email-enabled and disabled states |
| P1 | All catalogue covers are generated as the same gradient with the title repeated below. | Add real guide covers and readable sample pages; use actual software screenshots for the toolkit. | M; buyers can distinguish format and contents |
| P1 | Four service cards describe capabilities but provide no direct action or delivery process. Payroll enquiries depend on `mailto:`. | Add service-specific enquiry actions and a simple process: describe workflow → confirm scope → agree proposal → deliver. Offer WhatsApp and email. | M; enquiries retain service context |
| P1 | About text is broad; GitHub and LinkedIn carry most of the external credibility. “Worldwide customers” is asserted without supporting evidence on the page. | Add verified creator credentials, relevant work examples, and permissioned testimonials when available. Remove or substantiate unsupported claims. | M; every proof claim is traceable |
| P1 | Product details are modal-only, with no individual shareable product URLs. Sitemap contains the homepage only. | Add persistent product URLs with meaningful titles, descriptions, and direct access to the correct purchase selection. | L; direct navigation and refresh work |
| P1 | Catalogue loading blocks loading `app.js`, which also wires the mobile menu. There is no fetch timeout or initial loading state. | Wire navigation independently; show a loading state, bounded failure handling, and an intentional empty-catalogue state. Keep stale purchase buttons disabled on failure. | M; menu works during delayed/failed catalogue loading |
| P1 | Menu toggles a class without expanded-state semantics or closing after link selection. Dialogs have a role but no programmatic name. | Add accessible menu state and dialog labels; verify focus return, keyboard use, and touch targets. | M; keyboard and assistive-technology checks |
| P2 | Large mobile hero spacing, single-column catalogue, fixed WhatsApp control, and sticky header may create excessive scrolling or overlap. These are CSS-based risks, not observed failures. | Test compact mobile layouts, anchor offsets, safe-area spacing, and floating support placement before deciding changes. | M; validate small screens and zoom |
| P1 | No funnel analytics instrumentation was found in inspected first-party frontend files. Platform-level analytics may still exist. | Establish separate purchase and service funnels with privacy-conscious events and verified order outcomes. | M; reconcile event counts against server records |

## 6. Proposed information architecture

Keep one brand and site initially. A multi-page structure supports different buying questions without the cost and maintenance burden of separate sites. Retaining only a single long page is cheaper but limits campaign relevance and shareable product information.

Proposed destinations, with final routing adapted to the existing static/server-function setup:

- Home: broad positioning, audience routes, selected offers, proof, service introduction.
- Shop: published resources and tools, with simple audience/category filters.
- Product detail: one stable URL per published item.
- Services: service outcomes, examples, engagement process, contextual enquiry actions.
- About/work: creator credibility and genuine examples.
- Support: purchase recovery, download help, contact options, refund/support terms.

Avoid adding accounts, a cart, subscriptions, a blog, or a complex quiz in the initial upgrade. The current single-product checkout pattern is sufficient unless buyer research establishes a need for more.

## 7. Homepage blueprint

1. **Header:** brand, Shop, Business Solutions, About, Purchase Support; clear service-enquiry action where space allows.
2. **Hero:** plain explanation, one primary shop action, one secondary service action, and an authentic product/workflow preview.
3. **Audience routes:** “Grow your skills,” “Improve business workflows,” and “Build a custom solution.” Use explicit product examples beneath each.
4. **Selected products:** a small curated set with audience, outcome, format, price, and preview action. Do not call anything a bestseller without sales evidence.
5. **Demonstrated value:** real sample pages or an annotated workflow example. Clearly label fictional demonstration data.
6. **How buying works:** choose a product → pay through Paystack → return to confirmation and download. Explain current same-browser access and cross-device support.
7. **Custom services:** practical problems solved, relevant example, delivery process, enquiry action.
8. **Creator and proof:** verified credentials, work samples, and genuine feedback when available.
9. **Focused FAQ and footer:** formats, compatibility, access, support, policy links, and contact.

Draft hero direction for testing: **“Practical guides and tools for your next step.”** Supporting text: “Explore resources for work, learning and business—or get help automating your organisation’s workflows.” Actions: **Explore guides & tools** and **Discuss a business workflow**. This is proposed copy, not an established positioning decision.

## 8. Product detail and merchandising

Each detail page should include: clear product name; intended audience; concrete use cases; actual preview; authoritative price; primary purchase action; detailed contents; formats and requirements; licence/use terms; creator evidence; delivery/support explanation; refund-policy link; and product-specific questions.

For guides, verify actual package contents before stating page count, PDF/EPUB availability, worksheets, update entitlement, or reading time. Replace vague phrases such as “buyer package delivery” with verified contents. Describe learning and preparation outcomes without promising jobs, clients, scholarships, or earnings.

For the university toolkit, show the actual workbook and exception report, supported Excel version/platform, required input columns, setup steps, limitations, and licence scope after verification. Offer a contextual enquiry or demonstration route alongside purchase. State offline operation only to the extent supported by the actual product.

For the bundle, name and link all five included guides. At audited prices, the individual total is ₦51,500 and bundle price is ₦35,000: a ₦16,500 difference, approximately 32%. Display savings only when calculated from current eligible catalogue prices, and suppress stale comparisons. Do not imply that the university toolkit is included.

Use meaningful covers and screenshots, consistent image ratios, shorter card summaries, and a clear price/action hierarchy. Keep the existing palette; use gold sparingly. Prefer readable body text and real product evidence over animation, decorative dashboards, or repeated title blocks.

## 9. Checkout, access, and support

- Keep the short checkout. Show product, exact payable total, currency, delivery expectations, support, and policy links together.
- The current API exposes NGN only. Avoid making visitors choose a currency when only one is available; explain the charged currency. Do not promise international payment availability without provider verification.
- Name Paystack before the redirect so the external destination is expected. Preserve the existing destination validation and retry/idempotency behavior.
- Explain why email is requested without implying automatic email delivery while it is disabled.
- On confirmation, prioritize files and getting-started instructions. Explain that expiring download links can be refreshed; avoid making customers think their purchase expires after ten minutes.
- Add a clear way to retain the purchase reference and return to purchase support. Do not present a saved page URL as sufficient access on another device.
- Adapt timeout, missing-reference, pending-payment, and recovery copy to the actual email-enabled state. Preserve “you do not need to pay again.”
- Longer term, reliable self-service recovery could reduce support friction, but re-enabling email is a separate operational decision. README “Current delivery settings” and deployment guide sections 2 and 6 explicitly retain paused email and operator-assisted recovery.

## 10. Measurement and experiments

First establish the baseline. Separate product, business-software, and service journeys; segment by device, landing page, source, and product where volume permits.

| Metric | Definition | Why it matters |
| --- | --- | --- |
| Purchase conversion | Eligible storefront sessions with at least one verified paid order / eligible storefront sessions | Overall purchase effectiveness |
| Product-to-checkout rate | Product viewers starting checkout / product viewers, within a defined attribution window | Product clarity and purchase intent |
| Checkout completion | Distinct checkout attempts resulting in verified payment / distinct checkout attempts | Checkout friction and provider outcomes |
| Revenue per session | Verified collected revenue, with refunds reported separately / eligible sessions | Balances conversion and order value |
| Delivery access | Paid orders with a successful authorized file response / paid orders | Delivery reliability; a response does not prove the buyer opened the file |
| Qualified service enquiries | Enquiries with relevant need and enough detail to assess fit | Service pipeline quality |
| Service win rate | Won projects / qualified enquiries from the same mature cohort | Commercial outcome beyond clicks |

Suggested events: product viewed, preview opened, checkout opened, checkout redirected, checkout error, payment confirmed, download requested, authorized download response, service enquiry clicked. A WhatsApp click is not a conversation or qualified lead. Deduplicate payment events server-side and distinguish test/live orders. Never send email addresses, payment references, recovery credentials, or signed URLs to analytics.

Experiment sequence: clearer hero/audience routing → real preview and detailed product information → contextual service actions. Fix misleading copy and accessibility defects directly. For experiments, define one primary metric, guardrails, exposure rules, and sample requirements before starting; use moderated task testing first if traffic is too low for a reliable split test. Do not declare success from a short before/after revenue fluctuation.

## 11. Delivery sequence and acceptance gates

| Phase | Work | Completion gate |
| --- | --- | --- |
| 0: Evidence and decisions | Establish analytics baseline; confirm commercial priority, actual product contents, policies, service process, proof assets | No invented offer details or unsupported claims; approved content inputs |
| 1: Remove friction | Correct delivery/recovery copy; clarify hero; add contextual enquiries; fix menu/loading behavior and semantics; establish measurement | Truthful states, working navigation under catalogue failure, actionable service path |
| 2: Product presentation | Real previews, revised cards, persistent product pages, toolkit requirements, accurate bundle comparison | A buyer can determine suitability and share a product URL before paying |
| 3: Service credibility | Work examples, creator credentials, service process, support destination and policy links | Visitors understand the proposed engagement and next step |
| 4: Validate and iterate | Device testing, accessibility, performance, configured test-provider checkout and file access; then controlled experiments | No critical journey defects; agreed metrics and ongoing review |

Effort depends heavily on available product samples, policy decisions, and proof assets; these are sequencing phases, not a fixed delivery-date commitment.

Use representative tasks: find the right beginner career guide and explain its contents; check the university toolkit's software requirements; find refund and recovery information before buying; request payroll automation help; recover a purchase with email disabled. Test on small phones, tablet, and desktop, including slow catalogue responses, keyboard navigation, zoom, modal focus, long titles, and the fixed WhatsApp control.

Performance targets are LCP ≤2.5s, INP ≤200ms, and CLS ≤0.1 at the 75th percentile, segmented by device. These are targets, not current measurements. Start touch controls at a practical 44px design target and verify WCAG 2.2 AA target-size/spacing requirements, contrast, accessible names, and reflow. Avoid unnecessary frontend dependencies.

## 12. Implementation boundaries and reversibility

- Preserve Supabase as the price/publication authority. README “Application structure” and deployment guide section 5 prohibit activating products through stale static catalogue data.
- Preserve private assets, server verification, purchase entitlements, test/live separation, idempotency, and existing paid-order access. UI changes must not weaken delivery authorization.
- `scripts/build.js` explicitly allowlists public assets. New pages/images must be included deliberately; route and sitemap changes must match deployed destinations.
- Existing CSP permits same-origin scripts and images only, plus data images. Choose analytics/media delivery deliberately; do not weaken security policy broadly to accommodate a widget.
- Likely implementation areas: `index.html`, `styles.css`, `app.js`, `catalog-loader.js`, `payment-success.html`, `purchase.js`, `scripts/build.js`, `sitemap.xml`, and focused frontend/integration tests. Product presentation fields may require a separately reviewed catalogue/schema change.
- Keep work in small reviewable changes: truthful copy/accessibility; navigation/loading; product media/detail pages; service proof; measurement. Add behavior tests before changes to loading, filtering, currency display, recovery, and checkout selection.
- Validate with relevant focused tests, then project checks documented in README. Use configured test-provider acceptance before production changes. Do not infer a live payment pass from local stubs.
- Roll back presentation changes through new revert commits while retaining paid-order access. No database, payment-provider, email-enablement, push, or deployment changes are authorized by this planning document.

## 13. Research informing the plan

The following research supports general principles; applying it to BGM is a recommendation requiring local validation, not proof of a specific conversion lift.

- [Nielsen Norman Group: Homepage Design—5 Fundamental Principles](https://www.nngroup.com/articles/homepage-design-principles/): clarify purpose, show concrete examples, and guide visitors to appropriate actions. Supports the proposed hero and audience routes.
- [Baymard: Insufficient Product Descriptions](https://baymard.com/research-articles/product-descriptions): buyers need enough information to understand a product. Supports consistent contents, requirements, and preview information; BGM's downloadable-product details are a site-specific application.
- [W3C: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): WCAG 2.2 AA generally requires 24×24 CSS pixels or qualifying spacing/exceptions. [Enhanced target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced) explains the larger 44×44 target; do not confuse the enhanced criterion with the AA minimum.
- [Google: Web Vitals](https://web.dev/articles/vitals): defines loading, responsiveness, and visual-stability thresholds and the 75th-percentile assessment used in the acceptance targets.

The work needs conversion-focused UX research, information architecture, ecommerce copy, product visual design, accessibility, frontend implementation, and funnel measurement. No new plugin installation or framework migration is needed to begin. Visual browser review remains an explicit acceptance gate because it could not be completed during this audit.
