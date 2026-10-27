
// Supabase is the authority for directly purchasable products.
// Retain locally defined enquiry-only services, but never expose stale
// static Buy Now buttons if the API fails or a product is Draft.
(async () => {
  const staticProducts = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];
  const services = staticProducts.filter(p => p.status === 'service' && !p.paymentEnabled);
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store' });
    if (!response.ok) throw new Error('Catalogue API HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data.products)) throw new Error('Invalid catalogue response');
    window.PRODUCTS = [...data.products, ...services];
  } catch (error) {
    console.error('Catalogue unavailable; checkout disabled:', error);
    window.PRODUCTS = services;
  } finally {
    const script = document.createElement('script');
    script.src = 'app.js';
    document.body.appendChild(script);
  }
})();
