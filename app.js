'use strict';
const products = window.PRODUCTS || [];
const $ = selector => document.querySelector(selector);
const grid = $('#product-grid'), search = $('#search'), category = $('#category');
const modal = $('#modal'), checkoutModal = $('#checkout-modal');
const form = $('#checkout-form'), errorBox = $('#checkout-error'), submit = $('#checkout-submit');
let selection = null, requestVersion = 0, lastFocus;
document.querySelector('#year').textContent = new Date().getFullYear();
$('.menu').addEventListener('click', () => $('nav').classList.toggle('open'));

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
  const link = node('a', 'Send enquiry', className);
  // Static services may link to email, never arbitrary catalogue-supplied javascript URLs.
  link.href = 'mailto:badmurs0@gmail.com?subject=' + encodeURIComponent(product.name + ' enquiry');
  return link;
}
for (const name of [...new Set(products.map(p => p.category))].sort()) {
  const option = node('option', name); option.value = name; category.append(option);
}
function purchaseAction(product, className) {
  if (product.status === 'service') return enquiry(product, className);
  if (product.paymentEnabled) return button('Buy now', () => startPayment(product.id), className);
  const disabled = button('Checkout unavailable', () => {}, className); disabled.disabled = true; return disabled;
}
function render() {
  const query = search.value.toLowerCase().trim();
  const items = products.filter(p => (category.value === 'all' || p.category === category.value) &&
    `${p.name} ${p.short} ${p.category}`.toLowerCase().includes(query));
  grid.replaceChildren(...items.map(p => {
    const card = node('article', undefined, 'card'), body = node('div', undefined, 'card-body');
    const actions = node('div', undefined, 'card-actions');
    actions.append(button('Details', () => details(p)), purchaseAction(p, 'buy'));
    body.append(node('span', p.category, 'tag'), node('h3', p.name), node('p', p.short), node('div', p.price, 'price'), actions);
    card.append(node('div', p.name, 'cover'), body); return card;
  }));
  $('#empty').hidden = items.length > 0;
}
function show(dialog) {
  lastFocus = document.activeElement;
  dialog.hidden = false; document.body.style.overflow = 'hidden';
  dialog.querySelector('button, input, a')?.focus();
}
function close(dialog) {
  dialog.hidden = true;
  if (dialog === checkoutModal) { selection = null; requestVersion++; }
  if (modal.hidden && checkoutModal.hidden) document.body.style.overflow = '';
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
  close(modal);
  selection = { product, key: null, fingerprint: null };
  requestVersion++;
  $('#checkout-product-name').textContent = `${product.name} — ${product.price}`;
  $('#checkout-email').value = '';
  const currency = $('#checkout-currency');
  currency.replaceChildren(...Object.keys(product.amounts).map(code => {
    const option = node('option', `${code} — ${new Intl.NumberFormat('en-NG', { style: 'currency', currency: code }).format(product.amounts[code] / 100)}`);
    option.value = code; return option;
  }));
  errorBox.hidden = true; submit.disabled = false; submit.textContent = 'Continue to secure payment';
  show(checkoutModal); $('#checkout-email').focus();
}
$('#close').addEventListener('click', () => close(modal));
$('#checkout-close').addEventListener('click', () => close(checkoutModal));
for (const dialog of [modal, checkoutModal]) {
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  dialog.addEventListener('click', event => { if (event.target === dialog) close(dialog); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') close(dialog);
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled),a[href],input,select')];
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
    if (!session.ok) throw new Error('Could not start a secure session. Please allow cookies and retry.');
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
search.addEventListener('input', render); category.addEventListener('change', render);
render();
