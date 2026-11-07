'use strict';
(async () => {
  const services = (Array.isArray(window.PRODUCTS) ? window.PRODUCTS : []).filter(product => product.status === 'service' && !product.paymentEnabled);
  const status = document.querySelector('#catalog-status');
  const retry = document.querySelector('#catalog-retry');
  retry.addEventListener('click', () => location.reload());
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Catalogue unavailable');
    const data = await response.json();
    if (!Array.isArray(data.products) || !data.products.every(product =>
      product && typeof product.id === 'string' && typeof product.name === 'string' &&
      typeof product.category === 'string' && typeof product.short === 'string' &&
      typeof product.description === 'string' && typeof product.price === 'string' &&
      Array.isArray(product.features) && product.features.every(feature => typeof feature === 'string') &&
      typeof product.paymentEnabled === 'boolean' && product.amounts && typeof product.amounts === 'object' &&
      !Array.isArray(product.amounts) && Object.entries(product.amounts).every(([code, amount]) => /^[A-Z]{3}$/.test(code) && Number.isSafeInteger(amount) && amount >= 100) &&
      (!product.paymentEnabled || Object.keys(product.amounts).length > 0))) throw new Error('Invalid catalogue');
    window.PRODUCTS = [...data.products, ...services];
    status.textContent = data.products.length ? '' : 'No downloads are available right now. You can still ask about a custom solution.';
    status.hidden = data.products.length > 0;
    if (data.preview === true) {
      status.hidden = false;
      status.textContent = 'Read-only preview: current public products are shown. Payments are disabled here.';
    }
  } catch {
    window.PRODUCTS = services;
    status.textContent = 'The product catalogue is temporarily unavailable. Try again or contact BGM for help.';
    retry.hidden = false;
  } finally {
    const script = document.createElement('script');
    script.src = 'app.js';
    script.onerror = () => {
      status.hidden = false;
      status.textContent = 'The collection could not load. Try again or use the support link above.';
      retry.hidden = false;
    };
    document.body.appendChild(script);
  }
})();
