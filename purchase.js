'use strict';
const $ = selector => document.querySelector(selector);
let reference = new URLSearchParams(location.search).get('reference') || new URLSearchParams(location.search).get('trxref');
let busy = false, retries = 0, timer, emailEnabled = false;
async function check() {
  if (!reference || busy) return;
  busy = true; $('#retry').disabled = true; $('#retry').hidden = false;
  $('#reference').textContent = `Payment reference: ${reference}`;
  $('#recovery-reference').value = reference;
  $('#title').textContent = 'Checking your payment';
  $('#message').textContent = 'Please wait while we confirm your purchase.';
  try {
    const response = await fetch(`/api/verify-payment?reference=${encodeURIComponent(reference)}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Verification is temporarily unavailable.');
    if (!data.verified) {
      $('#title').textContent = 'Payment confirmation pending';
      $('#message').textContent = 'Your payment has not been confirmed yet. If you have paid, please wait and check again. You do not need to pay again.';
      if (retries++ < 4) timer = setTimeout(check, Math.min(15000, 3000 * retries));
      return;
    }
    $('#title').textContent = 'Your purchase is ready';
    $('#message').textContent = `Payment confirmed for ${data.product.name}. Download your files below.${data.emailEnabled ? ' An access email will also be sent.' : ' Save this purchase page for future access in this browser. For help on another device, contact us on WhatsApp.'}`;
    $('#download-list').replaceChildren(...data.downloads.map(item => {
      const p = document.createElement('p'), a = document.createElement('a');
      const url = new URL(item.url, location.origin);
      if (url.origin !== location.origin || url.pathname !== '/api/download') throw new Error('Invalid download address');
      a.href = url.href; a.className = 'btn primary'; a.textContent = `Download ${item.name}`;
      p.append(a); return p;
    }));
    $('#downloads').hidden = false;
    try { sessionStorage.removeItem('bgm-checkout'); } catch { /* Optional storage. */ }
  } catch (error) {
    $('#downloads').hidden = true;
    $('#title').textContent = 'Purchase access needs attention';
    $('#message').textContent = error.name === 'TimeoutError' ? 'Confirmation is taking longer than expected. Check again shortly or contact BGM on WhatsApp. You do not need to pay again.' : error.message;
  } finally { busy = false; $('#retry').disabled = false; }
}
$('#retry').addEventListener('click', () => { clearTimeout(timer); check(); });
$('#recovery-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#recover'); if (button.disabled) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/recover-purchase', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ email: $('#recovery-email').value.trim(), reference: $('#recovery-reference').value.trim() })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Recovery is temporarily unavailable.');
    $('#recovery-message').textContent = data.message;
  } catch (error) { $('#recovery-message').textContent = error.message; }
  finally { button.disabled = false; }
});
async function start() {
  try {
    const status = await fetch('/api/store-status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const settings = await status.json();
    if (status.ok && settings.emailEnabled) {
      emailEnabled = true;
      $('#recovery-form').hidden = false;
      $('#recovery-help').textContent = 'Enter your checkout email and payment reference to receive an access link.';
    }
  } catch { /* WhatsApp remains available when settings cannot load. */ }
  const token = new URLSearchParams(location.hash.slice(1)).get('access');
  if (token) {
    // Fragments never reach the server or referrers; remove the credential before further navigation.
    history.replaceState(null, '', location.pathname);
    try {
      const response = await fetch('/api/exchange-recovery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ token })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open this access link.');
      reference = data.reference;
      history.replaceState(null, '', `?reference=${encodeURIComponent(reference)}`);
    } catch (error) { $('#message').textContent = error.message; return; }
  }
  if (reference) await check();
  else $('#message').textContent = emailEnabled ? 'Recover an existing purchase using the form below, or contact us for help.' : 'Need your files? Contact BGM on WhatsApp with your payment reference and checkout email. We will verify your purchase before restoring access.';
}
start();
