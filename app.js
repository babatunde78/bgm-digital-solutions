'use strict';
const products = window.PRODUCTS || [];
const $ = selector => document.querySelector(selector);
const grid = $('#product-grid'), search = $('#search'), category = $('#category');
const modal = $('#modal'), checkoutModal = $('#checkout-modal');
const form = $('#checkout-form'), errorBox = $('#checkout-error'), submit = $('#checkout-submit');
let selection = null, requestVersion = 0, lastFocus, audience = 'all';
const presentations = {
  'herbal-plant-research-workbook': { image: 'herbal-research-analysis-toolkit-mockup', width: 1536, height: 1024, imageAlt: 'Illustrative cover of the Herbal Research Analysis Toolkit beside a pressed leaf and sample vial', usdReference: 25.11, usdRateDate: '2026-11-24', usdRateSource: 'published rate of NGN 1,394.12 per US dollar'},
  'questionnaire-research-design-alignment': { image: 'questionnaire-research-design-alignment-mockup', width: 1536, height: 1024, imageAlt: 'Illustrative mockup of the Questionnaire Research Design Alignment Pack cover and printable worksheets', usdReference: 5.38, usdRateDate: '2026-11-23', usdRateSource: 'reported Nigerian Foreign Exchange Market closing rate of ₦1,394.01 per US dollar'},
  'questionnaire-scale-scoring': { image: 'questionnaire-scale-scoring-dashboard', width: 1536, height: 1024, imageAlt: 'Excel dashboard showing scale results for a fictional questionnaire', usdReference: 10.76, usdRateDate: '2026-11-24', usdRateSource: 'CBN central USD/NGN reference'},
  'questionnaire-data-checking': { image: 'questionnaire-data-checking-mockup-v1', extension: 'png', width: 1536, height: 1024, usdReference: 10.8, usdRateDate: '2026-11-20', usdRateSource: 'CBN central reference' },
  'nigeria-small-employer-payroll': { image: 'nigeria-small-employer-payroll-mockup-v1', extension: 'png', width: 1536, height: 1024, usdReference: 18.35, usdRateDate: '2026-11-18', usdRateSource: 'CBN central reference reported at ₦1,362.73/USD'},
  'client-pack-assembler': { image: 'client-pack-assembler-mockup', extension: 'png', width: 1536, height: 1024, usdReference: 18.45, usdRateDate: '2026-11-17', usdRateSource: 'CBN central reference displayed by Canjean'},
  'sales-settlement-reconciler': { image: 'sales-settlement-reconciler-mockup', extension: 'png', width: 1536, height: 1024, usdReference: 11.07, usdRateDate: '2026-11-17', usdRateSource: 'CBN central reference, displayed by Canjean'},
  'furniture-quote-invoice': { image: 'furniture-quote-invoice-mockup', extension: 'png', width: 1536, height: 1024, usdReference: 14.82, usdRateDate: '2026-11-17', usdRateSource: 'ForexInvestors indicative USD/NGN reference'},
  'training-certificate-generator': { image: 'training-certificate-generator-v1.1.0', extension: 'png', width: 1536, height: 1024, usdReference: 33.02, usdRateDate: '2026-11-18', usdRateSource: 'Approximate equivalent at CBN central reference of NGN 1,362.73/USD' },
  'rental-income-arrears-ledger': { image: 'rental-income-arrears-ledger-mockup-v2', extension: 'jpg', width: 1200, height: 800, usdReference: 9.30, usdRateDate: '2026-11-15', usdRateSource: 'Public USD/NGN exchange-rate reference'},
  'drinks-stock-customer-book': { image: 'drinks-stock-customer-book-mockup-v2', extension: 'jpg', width: 1200, height: 800, usdReference: 9.24, usdRateDate: '2026-11-15', usdRateSource: 'CEII USD/NGN mid-market reference'},
  'bakery-recipe-costing': { image: 'bakery-recipe-costing', width: 1536, height: 1024, usdReference: 18.49, usdRateDate: '2026-11-14', usdRateSource: 'CEII mid-market reference (ExchangeRate-API)' },
  'aluminium-job-costing': { image: 'aluminium-job-costing', width: 1536, height: 1024, usdReference: 18.49, usdRateDate: '2026-11-14', usdRateSource: 'CEII mid-market reference (ExchangeRate-API)'},
  'paint-job-ledger': { image: 'paint-job-ledger-mockup', extension: 'png', width: 1536, height: 1024, usdReference: 29},
  'rent-clear': { image: 'rent-clear-mockup', extension: 'png', width: 1536, height: 1024, usdReference: 29},
  'batch-and-balance': { image: 'batch-and-balance', usdReference: 16.57, usdRateDate: '2026-11-11', usdRateSource: 'CBN central rate'},
  'contractor-cash-flow-planner': { image: 'contractor-cash-flow-planner-mockup', extension: 'jpg', width: 1200, height: 800, usdReference: 11.05, usdRateDate: '2026-11-17', usdRateSource: 'Proshare daily NAFEM rate (FMDQ source)'},
  'school-fee-reconciliation': { image: 'school-fee-reconciliation', usdReference: 7.39, usdRateDate: '2026-11-14', usdRateSource: 'CEII mid-market reference (ExchangeRate-API)'},
  'social-seller-bookkeeping': { image: 'social-seller-bookkeeping', usdReference: 11.01, usdRateDate: '2026-11-18', usdRateSource: 'Approximate equivalent at CBN central reference of NGN 1,362.73/USD' },
  '500-business-prompts': { image: 'business-prompts', usdReference: 9, format: 'Business resource', audience: 'For business owners planning, marketing and running their business.' },
  'ai-side-hustles': { image: 'ai-side-hustles', usdReference: 15, format: 'Business guide', audience: 'For people exploring and validating an AI-assisted service offer.' },
  'remote-job-2026-2027': { image: 'remote-jobs', usdReference: 12, format: 'Career guide', audience: 'For job seekers preparing applications and screening remote opportunities.' },
  'scholarships-abroad': { image: 'scholarships', usdReference: 15, format: 'Education guide', audience: 'For applicants researching funding and preparing scholarship applications.' },
  'first-upwork-client': { image: 'upwork', usdReference: 12, format: 'Career guide', audience: 'For skilled beginners preparing a portfolio and applying for Upwork projects.' },
  'five-guide-bundle': { image: 'five-guide-bundle', usdReference: 39, format: 'Guide collection', audience: 'For readers who want the five BGM guides in one purchase.' },
  'bgm-collections-bank': { image: 'collections-bank', usdReference: 40.75, format: 'Excel toolkit', audience: 'For university bursaries and treasury teams reconciling collection records.' },
  'campus-bursary-package-a': { image: 'campus-bursary-a', format: 'Student revenue & treasury · Excel', audience: 'For student-accounts and treasury teams that need traceable schedules from fee billing through receipt allocation and settlement review.' },
  'campus-bursary-package-b': { image: 'campus-bursary-b', format: 'Budget & expenditure control · Excel', audience: 'For bursary teams reviewing budgets, commitments, supplier bills, payments, advances and actual expenditure.' },
  'campus-bursary-full-excel': { image: 'campus-bursary-full-excel', format: 'Full bursary suite · Excel', audience: 'For institutions that want both operational packages plus manual ledger and control-account review schedules.' },
  'campus-bursary-documents': { image: 'campus-documents-pdf-mockup-v0.1.1', extension: 'png', imageFit: 'contain', width: 1102, height: 1378, usdReference: 148.11, usdRateDate: '2026-11-10', usdRateSource: 'CBN central rate', format: 'Offline Windows document software', audience: 'A focused offline Windows tool for receipts, student statements and payment vouchers; separate from the broader Campus Excel suites.' }
};
const campusDashboardPreviews = {
  'campus-bursary-documents': ['campus-documents-dashboard.jpg', 'Document work queue'],
  'campus-bursary-package-a': ['campus-package-a-dashboard.jpg', 'Collections and reconciliation'],
  'campus-bursary-package-b': ['campus-package-b-dashboard.jpg', 'Budget and payment control'],
  'campus-bursary-full-excel': ['campus-full-excel-dashboard.jpg', 'Bursar’s overview and ledger control checks']
};

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, action, className) {
  const element = node('button', text, className); element.type = 'button';
  element.addEventListener('click', action); return element;
}
function enquiry(product, className) {
  const link = node('a', 'Ask about this resource ↗', className);
  link.href = 'https://wa.me/2349031921294?text=' + encodeURIComponent('Hello BGM, I would like to ask about ' + product.name + '.');
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
for (const name of [...new Set(products.map(p => p.category))].sort()) {
  if (!category) break;
  const option = node('option', name); option.value = name; category.append(option);
}
function purchaseAction(product, className) {
  if (product.status === 'service') return enquiry(product, className);
  if (product.paymentEnabled) return button('Buy now', () => startPayment(product.id), className);
  const disabled = button('Checkout unavailable', () => {}, className); disabled.disabled = true; return disabled;
}
function displayPrice(product) {
  const presentation = presentations[product.id];
  const usd = product.usdReference || presentation?.usdReference;
  if (!usd || product.amounts?.USD) return product.price;
  const rateDate = product.usdRateDate || presentation?.usdRateDate;
  const date = rateDate ? ' approximate equivalent (rate date ' + new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(rateDate + 'T00:00:00Z')) + ')' : ' reference';
  return product.price + ' / US$' + usd + date;
}
function cover(product) {
  const presentation = presentations[product.id];
  const wrapper = node('div', undefined, 'cover');
  if (presentation?.image) {
    const image = document.createElement('img');
    image.src = 'assets/' + presentation.image + '.' + (presentation.extension || 'jpg');
    image.alt = product.name + ' — illustrative product mockup';
    if (presentation.imageFit === 'contain') image.classList.add('cover-contained');
    image.width = presentation.width || 1200; image.height = presentation.height || 800; image.loading = 'lazy'; image.decoding = 'async';
    wrapper.append(image);
  } else wrapper.append(node('span', product.name));
  return wrapper;
}
function render() {
  if (!grid) return;
  const query = search.value.toLowerCase().trim();
  const items = products.filter(p => (category.value === 'all' || p.category === category.value) &&
    (audience === 'all' || (audience === 'learning' ? ['Career Guides', 'Education Guides', 'Bundles'].includes(p.category) : ['Business Resources', 'Business Software', 'Bundles'].includes(p.category))) &&
    `${p.name} ${p.short} ${p.category}`.toLowerCase().includes(query));
  grid.replaceChildren(...items.map(p => {
    const card = node('article', undefined, 'card'), body = node('div', undefined, 'card-body');
    const actions = node('div', undefined, 'card-actions');
    const link = node('a', 'View resource →', 'product-link');
    link.href = 'product.html?id=' + encodeURIComponent(p.id);
    const titleLink = node('a', p.name); titleLink.href = link.href;
    const title = node('h3'); title.append(titleLink);
    actions.append(link, purchaseAction(p, 'buy'));
    body.append(node('span', presentations[p.id]?.format || p.category, 'tag'), title, node('p', p.short), node('div', displayPrice(p), 'price'), actions);
    const artwork = node('a', undefined, 'cover-link'); artwork.href = link.href; artwork.setAttribute('aria-label', 'View ' + p.name); artwork.append(cover(p));
    card.append(artwork, body); return card;
  }));
  $('#empty').hidden = items.length > 0;
  $('#product-count').textContent = items.length + (items.length === 1 ? ' resource' : ' resources');
  grid.setAttribute('aria-busy', 'false');
}
if (grid) grid.before(node('p', 'USD values are for reference. Checkout charges Nigerian naira (NGN); your bank’s conversion may differ. Product images are illustrative mockups.', 'small collection-note'));
function renderDetail() {
  const target = $('#product-detail');
  if (!target) return;
  target.setAttribute('aria-busy', 'false');
  const id = new URLSearchParams(location.search).get('id');
  const product = products.find(item => item.id === id);
  if (!product) {
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex'; document.head.append(robots);
    target.replaceChildren(node('h1', 'This resource is not available.'), node('p', 'Return to the collection to see current resources, or contact BGM for help.'));
    return;
  }
  document.title = product.name + ' | BGM Digital Solutions';
  document.querySelector('meta[name="description"]').content = product.short;
  const canonical = document.createElement('link'); canonical.rel = 'canonical'; canonical.href = 'https://www.bgmsolutions.site/product.html?id=' + encodeURIComponent(product.id); document.head.append(canonical);
  const presentation = presentations[product.id];
  const intro = node('div', undefined, 'detail-intro'), summary = node('div', undefined, 'detail-summary');
  const visual = node('figure', undefined, 'detail-visual'); visual.append(cover(product));
  if (product.status !== 'service') visual.append(node('figcaption', 'Illustrative mockup. Digital download; no physical product.'));
  const detailImage = visual.querySelector('img');
  if (detailImage) { detailImage.loading = 'eager'; detailImage.fetchPriority = 'high'; }
  summary.append(node('p', product.category, 'eyebrow'), node('h1', product.name), node('p', product.short, 'page-intro'));
  if (presentation) summary.append(node('p', presentation.audience, 'audience-description'));
  summary.append(node('div', displayPrice(product), 'detail-price'), purchaseAction(product, 'btn primary buy'));
  if ((product.usdReference || presentation?.usdReference) && !product.amounts?.USD) {
    const rateDate = product.usdRateDate || presentation?.usdRateDate;
    const rateSource = presentation?.usdRateSource;
    const formattedDate = rateDate ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(rateDate + 'T00:00:00Z')) : null;
    const note = rateSource && formattedDate
      ? 'Indicative USD equivalent uses the ' + rateSource + ' dated ' + formattedDate + '. Checkout remains in NGN; your provider’s rate and fees may differ.'
      : product.usdRateDate
        ? 'Approximate equivalent uses the historical reference rate in effect on ' + product.usdRateDate + '. Checkout charges NGN; your bank’s conversion may differ.'
        : 'USD is a reference value. Checkout charges NGN; your bank’s conversion may differ.';
    summary.append(node('p', note, 'small'));
  }
  if (product.status !== 'service') {
    const policy = node('a', '7-day refunds · Read the policy →', 'policy-link'); policy.href = 'support.html#refunds'; summary.append(policy);
  }
  summary.append(node('p', product.status === 'service' ? 'Custom deployment is discussed before work begins.' : 'Secure payment through Paystack. Download after payment confirmation.', 'small'));
  intro.append(visual, summary);
  const content = node('div', undefined, 'detail-content'), included = node('section'), list = node('ul', undefined, 'included-list');
  list.append(...product.features.map(feature => node('li', feature)));
  included.append(node('p', 'Inside this resource', 'eyebrow'), node('h2', 'What you get'), node('p', product.description), list);
  const requirements = node('section');
  requirements.append(node('h2', 'Before you buy'));
  if (product.id.startsWith('campus-bursary-')) {
    requirements.append(node('p', 'Microsoft 365 Excel for Windows 64-bit is the tested target. These are single-writer pilot workbooks, not secure multi-user accounting software. Review the operating guide, institution mappings and controls before use. Mac, Excel for the web and other versions are unverified.'),
      node('p', 'The displayed first-year amount includes the annual licence and standard setup. Storefront checkout is a one-time NGN payment; automatic renewal billing is not implemented. Renewal terms must be agreed before the licence term ends. The USD figure is a dated approximate equivalent.'));
  } else if (product.id === 'bgm-collections-bank') {
    requirements.append(node('p', 'This is an offline Excel toolkit. It compares receipts, Paystack records, settlements, bank deposits and cashbook entries. It does not connect to your bank account.'),
      node('p', 'Ask BGM to confirm compatibility with your Excel version, input files and intended use before buying.'));
  } else if (product.status !== 'service') {
    requirements.append(node('p', 'These resources support preparation and practical work. They do not guarantee jobs, scholarships, clients or earnings. Ask BGM if you need a specific file format or have a question about suitability.'));
  } else requirements.append(node('p', 'Describe your workflow and required output. Scope, delivery and project terms are discussed in a proposal.'));
  requirements.append(enquiry(product, 'text-link'));
  const access = node('section');
  access.append(node('h2', 'Your files & support'), node('p', 'After payment, return to the confirmation page to download your files. Keep the page in the same browser. For access on another device, contact support with your payment reference and checkout email.'));
  const support = node('a', 'Downloads, support & 7-day refunds →', 'text-link'); support.href = 'support.html'; access.append(support);
  content.append(included, requirements);
  const campusDashboardVideoPosters = {
    'campus-bursary-package-a': 'assets/campus-package-a-dashboard.jpg',
    'campus-bursary-package-b': 'assets/campus-package-b-dashboard.jpg',
    'campus-bursary-full-excel': 'assets/campus-full-excel-dashboard.jpg'
  };
  const campusPoster = campusDashboardVideoPosters[product.id];
  if (campusPoster) {
    const preview = node('section', undefined, 'campus-video-preview');
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'none';
    video.poster = campusPoster;
    video.setAttribute('aria-label', 'Silent Campus Bursary dashboard preview');
    const source = document.createElement('source');
    source.src = 'https://assets.vidiq.com/compositions/4c3f39ac-4f49-4706-9de1-b7996cb7c215/zccp673aa19tyfsoejpw061m.mp4';
    source.type = 'video/mp4';
    video.append(source);
    const fileLink = node('a', 'Open the video preview in a new tab', 'text-link');
    fileLink.href = source.src;
    fileLink.target = '_blank';
    fileLink.rel = 'noopener noreferrer';
    preview.append(node('p', 'Short video preview', 'eyebrow'), node('h2', 'Preview the Campus dashboards'), video,
      node('p', 'This silent preview shows the layouts of Packages A, B and Full Excel. All figures are fictional demo data.', 'small'), fileLink);
    content.append(preview);
  }
  const dashboardPreview = campusDashboardPreviews[product.id];
  if (dashboardPreview) {
    const [file, title] = dashboardPreview;
    const previewUrl = 'assets/' + file;
    const section = node('section', undefined, 'dashboard-preview');
    const figure = node('figure');
    const image = document.createElement('img');
    image.src = previewUrl;
    image.alt = title + ' dashboard with fictional demonstration data';
    image.loading = 'lazy';
    image.decoding = 'async';
    const fullSize = node('a');
    fullSize.href = previewUrl;
    fullSize.setAttribute('aria-label', 'Open full-size ' + title + ' dashboard preview');
    fullSize.append(image);
    const caption = product.id === 'campus-bursary-documents'
      ? 'Fictional demonstration view of the offline document workflow.'
      : product.features.includes('Redesigned dashboard included')
        ? 'Dashboard shown with fictional data.'
        : 'Dashboard design preview with fictional data. The current download uses the previous layout.';
    figure.append(fullSize, node('figcaption', caption));
    section.append(node('h2', title), figure);
    content.append(section);
  }
  if (product.status !== 'service') content.append(access);
  if (product.id === 'five-guide-bundle') {
    const ids = ['500-business-prompts', 'ai-side-hustles', 'remote-job-2026-2027', 'scholarships-abroad', 'first-upwork-client'];
    const guides = ids.map(id => products.find(item => item.id === id && item.status === 'live'));
    if (guides.every(Boolean)) {
      const bundle = node('section'), links = node('ul', undefined, 'included-list');
      for (const guide of guides) {
        const li = node('li'), link = node('a', guide.name);
        link.href = 'product.html?id=' + encodeURIComponent(guide.id); li.append(link); links.append(li);
      }
      bundle.append(node('h2', 'The five guides'), links);
      const total = guides.reduce((sum, guide) => sum + (guide.amounts?.NGN || 0), 0);
      if (guides.every(guide => Number.isSafeInteger(guide.amounts?.NGN)) && product.amounts?.NGN && total > product.amounts.NGN) {
        const money = amount => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount / 100);
        bundle.append(node('p', 'Bought separately: ' + money(total) + '. Bundle: ' + money(product.amounts.NGN) + '. Save ' + money(total - product.amounts.NGN) + '.', 'bundle-saving'));
      }
      included.after(bundle);
    }
  } else if (product.id === 'campus-bursary-full-excel') {
    const packageA = products.find(item => item.id === 'campus-bursary-package-a' && item.status === 'live');
    const packageB = products.find(item => item.id === 'campus-bursary-package-b' && item.status === 'live');
    const separate = (packageA?.amounts?.NGN || 0) + (packageB?.amounts?.NGN || 0);
    const saving = separate - (product.amounts?.NGN || 0);
    if (packageA && packageB && Number.isSafeInteger(separate) && Number.isSafeInteger(product.amounts?.NGN) && saving > 0) {
      const money = amount => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount / 100);
      const comparison = node('section');
      comparison.append(node('h2', 'Compare the first-year totals'), node('p', 'Package A and Package B separately: ' + money(separate) + '. Full Excel first-year total: ' + money(product.amounts.NGN) + '. Save ' + money(saving) + '.', 'bundle-saving'));
      included.after(comparison);
    }
  }
  target.replaceChildren(intro, content);
}
function show(dialog) {
  lastFocus = document.activeElement;
  dialog.hidden = false; document.body.style.overflow = 'hidden';
  for (const background of document.querySelectorAll('main,header,footer')) background.inert = true;
  dialog.querySelector('button, input, a')?.focus();
}
function closeDialog(dialog) {
  dialog.hidden = true;
  if (dialog === checkoutModal) { selection = null; requestVersion++; }
  if (modal.hidden && checkoutModal.hidden) {
    document.body.style.overflow = '';
    for (const background of document.querySelectorAll('main,header,footer')) background.inert = false;
  }
  lastFocus?.focus();
}
function details(product) {
  const content = $('#modal-content'), list = node('ul');
  list.append(...product.features.map(feature => node('li', feature)));
  content.replaceChildren(node('span', product.category, 'tag'), node('h2', product.name), node('p', product.description),
    node('h3', "What's included"), list, node('div', product.price, 'price'), purchaseAction(product, 'btn primary'));
  show(modal);
}
function startPayment(id) {
  const product = products.find(p => p.id === id && p.paymentEnabled);
  if (!product) return;
  if (!modal.hidden) closeDialog(modal);
  selection = { product, key: null, fingerprint: null };
  requestVersion++;
  $('#checkout-email').value = '';
  const currency = $('#checkout-currency');
  currency.replaceChildren(...Object.keys(product.amounts).map(code => {
    const option = node('option', `${code} — ${new Intl.NumberFormat('en-NG', { style: 'currency', currency: code }).format(product.amounts[code] / 100)}`);
    option.value = code; return option;
  }));
  $('#currency-field').hidden = currency.options.length === 1;
  $('#checkout-product-name').textContent = product.name + ' — ' + currency.selectedOptions[0].textContent;
  currency.onchange = () => { $('#checkout-product-name').textContent = product.name + ' — ' + currency.selectedOptions[0].textContent; };
  errorBox.hidden = true; submit.disabled = false; submit.textContent = 'Continue to secure payment';
  show(checkoutModal); $('#checkout-email').focus();
}
$('#close').addEventListener('click', () => closeDialog(modal));
$('#checkout-close').addEventListener('click', () => closeDialog(checkoutModal));
modal.setAttribute('aria-label', 'Product details');
for (const dialog of [modal, checkoutModal]) {
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDialog(dialog);
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled),a[href],input,select')].filter(element => !element.closest('[hidden]'));
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!selection || !form.reportValidity() || submit.disabled) return;
  const current = selection, version = requestVersion;
  const email = $('#checkout-email').value.trim().toLowerCase(), currency = $('#checkout-currency').value;
  const fingerprint = JSON.stringify([current.product.id, email, currency]);
  // Keep retries, page reloads and reopened modals on the same attempt for this basket.
  if (current.fingerprint !== fingerprint) {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem('bgm-checkout')); } catch { /* Storage can be disabled. */ }
    current.key = saved?.fingerprint === fingerprint ? saved.key : crypto.randomUUID();
    current.fingerprint = fingerprint;
    try { sessionStorage.setItem('bgm-checkout', JSON.stringify({ fingerprint, key: current.key })); } catch { /* In-memory retries still work. */ }
  }
  submit.disabled = true; submit.textContent = 'Opening secure payment…'; errorBox.hidden = true;
  try {
    const session = await fetch('/api/session', { method: 'POST', signal: AbortSignal.timeout(15000) });
    if (version !== requestVersion) return;
    if (!session.ok) {
      const failure = await session.json().catch(() => null);
      throw new Error(typeof failure?.error === 'string' ? failure.error : 'Checkout could not start. Please refresh the page and try again.');
    }
    const response = await fetch('/api/initialize-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ email, currency, productId: current.product.id, idempotencyKey: current.key })
    });
    const data = await response.json();
    if (version !== requestVersion) return;
    if (!response.ok || !data.authorization_url) throw new Error((data.error || 'Could not open checkout.') + (data.reference ? ` Reference: ${data.reference}` : ''));
    const target = new URL(data.authorization_url, location.origin);
    if (target.origin !== location.origin && (target.protocol !== 'https:' || target.hostname !== 'checkout.paystack.com')) throw new Error('Unexpected checkout address.');
    location.assign(target.href);
  } catch (error) {
    if (version !== requestVersion) return;
    errorBox.textContent = error.name === 'TimeoutError' ? 'Checkout is taking longer than expected. Retry the same purchase; avoid submitting another payment.' : error.message;
    errorBox.hidden = false;
  } finally {
    if (version === requestVersion) { submit.disabled = false; submit.textContent = 'Continue to secure payment'; }
  }
});
search?.addEventListener('input', render); category?.addEventListener('change', render);
for (const element of document.querySelectorAll('[data-filter], [data-audience]')) {
  element.addEventListener('click', () => {
    audience = element.dataset.filter || element.dataset.audience;
    category.value = 'all'; search.value = '';
    for (const tab of document.querySelectorAll('[data-filter]')) tab.setAttribute('aria-pressed', String(tab.dataset.filter === audience));
    render();
  });
}
$('#clear-filters')?.addEventListener('click', () => {
  audience = 'all'; search.value = ''; category.value = 'all';
  for (const tab of document.querySelectorAll('[data-filter]')) tab.setAttribute('aria-pressed', String(tab.dataset.filter === 'all'));
  render();
});
render();
renderDetail();
