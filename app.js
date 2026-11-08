'use strict';
const products = window.PRODUCTS || [];
const $ = selector => document.querySelector(selector);
const grid = $('#product-grid'), search = $('#search'), category = $('#category');
const modal = $('#modal'), checkoutModal = $('#checkout-modal');
const form = $('#checkout-form'), errorBox = $('#checkout-error'), submit = $('#checkout-submit');
let selection = null, requestVersion = 0, lastFocus, audience = 'all';
const presentations = {
  '500-business-prompts': { image: 'business-prompts', usdReference: 9, format: 'Business resource', audience: 'For business owners planning, marketing and running their business.' },
  'ai-side-hustles': { image: 'ai-side-hustles', usdReference: 15, format: 'Business guide', audience: 'For people exploring and validating an AI-assisted service offer.' },
  'remote-job-2026-2027': { image: 'remote-jobs', usdReference: 12, format: 'Career guide', audience: 'For job seekers preparing applications and screening remote opportunities.' },
  'scholarships-abroad': { image: 'scholarships', usdReference: 15, format: 'Education guide', audience: 'For applicants researching funding and preparing scholarship applications.' },
  'first-upwork-client': { image: 'upwork', usdReference: 12, format: 'Career guide', audience: 'For skilled beginners preparing a portfolio and applying for Upwork projects.' },
  'five-guide-bundle': { image: 'five-guide-bundle', usdReference: 39, format: 'Guide collection', audience: 'For readers who want the five BGM guides in one purchase.' },
  'bgm-collections-bank': { image: 'collections-bank', usdReference: 40.75, format: 'Excel toolkit', audience: 'For university bursaries and treasury teams reconciling collection records.' },
  'campus-bursary-package-a': { image: 'campus-bursary-a', format: 'Student revenue & treasury · Excel', audience: 'For student-accounts and treasury teams that need traceable schedules from fee billing through receipt allocation and settlement review.' },
  'campus-bursary-package-b': { image: 'campus-bursary-b', format: 'Budget & expenditure control · Excel', audience: 'For bursary teams reviewing budgets, commitments, supplier bills, payments, advances and actual expenditure.' },
  'campus-bursary-full-excel': { image: 'campus-bursary-full-excel', format: 'Full bursary suite · Excel', audience: 'For institutions that want both operational packages plus manual ledger and control-account review schedules.' }
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
  const usd = product.usdReference || presentations[product.id]?.usdReference;
  if (!usd || product.amounts?.USD) return product.price;
  const date = product.usdRateDate ? ' approximate equivalent (rate date ' + new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(product.usdRateDate + 'T00:00:00Z')) + ')' : ' reference';
  return product.price + ' / US$' + usd + date;
}
function cover(product) {
  const presentation = presentations[product.id];
  const wrapper = node('div', undefined, 'cover');
  if (presentation?.image) {
    const image = document.createElement('img');
    image.src = 'assets/' + presentation.image + '.jpg';
    image.alt = product.name + ' — illustrative product mockup';
    image.width = 1200; image.height = 800; image.loading = 'lazy'; image.decoding = 'async';
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
  if ((product.usdReference || presentation?.usdReference) && !product.amounts?.USD) summary.append(node('p', product.usdRateDate ? 'Approximate equivalent uses the historical reference rate in effect on ' + product.usdRateDate + '. Checkout charges NGN; your bank’s conversion may differ.' : 'USD is a reference value. Checkout charges NGN; your bank’s conversion may differ.', 'small'));
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
