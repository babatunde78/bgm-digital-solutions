'use strict';

function siteUrl() {
  const url = new URL(process.env.SITE_URL || '');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Invalid SITE_URL');
  }
  if (process.env.VERCEL_ENV === 'production' && url.protocol !== 'https:') throw new Error('HTTPS required');
  return url.origin;
}

function mode() {
  const value = process.env.PAYSTACK_MODE;
  if (!['test', 'live'].includes(value) || !process.env.PAYSTACK_SECRET_KEY?.startsWith(`sk_${value}_`)) {
    throw new Error('Payment environment is not configured');
  }
  return value;
}

function currencies() {
  return (process.env.PAYSTACK_CURRENCIES || 'NGN').split(',').map(s => s.trim()).filter(s => /^[A-Z]{3}$/.test(s));
}

function emailEnabled() {
  return process.env.EMAIL_ENABLED === 'true' && Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function checkoutChecks() {
  let canonicalUrl = false, paymentEnvironment = false;
  try { siteUrl(); canonicalUrl = true; } catch { /* Report configuration flags, never values. */ }
  try { mode(); paymentEnvironment = true; } catch { /* Key prefix must match configured mode. */ }
  return {
    checkoutEnabled: process.env.CHECKOUT_ENABLED === 'true', canonicalUrl, paymentEnvironment,
    database: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    deliverySigning: Boolean(process.env.DELIVERY_SECRET?.length >= 32),
    // The SDK handles connected-store OIDC; VERCEL itself is not an authentication credential.
    storage: Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
    worker: Boolean(process.env.CRON_SECRET),
    webhook: Boolean(process.env.PAYSTACK_WEBHOOK_MODE === 'legacy' ||
      process.env.PAYSTACK_WEBHOOK_MODE === 'modern' && process.env.PAYSTACK_WEBHOOK_SECRETS?.split(',').some(s => s.trim().startsWith('whsec_')))
  };
}
function ready() { return Object.values(checkoutChecks()).every(Boolean); }

module.exports = { siteUrl, mode, currencies, ready, emailEnabled, checkoutChecks };
