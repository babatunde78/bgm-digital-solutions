const grid = document.querySelector('#product-grid');
const search = document.querySelector('#search');
const category = document.querySelector('#category');
const modal = document.querySelector('#modal');
const content = document.querySelector('#modal-content');

document.querySelector('#year').textContent = new Date().getFullYear();

document.querySelector('.menu').onclick = () => {
    document.querySelector('nav').classList.toggle('open');
};

const cats = [...new Set(PRODUCTS.map(p => p.category))].sort();

cats.forEach(c => {
    category.insertAdjacentHTML(
        'beforeend',
        `<option>${c}</option>`
    );
});

function esc(s = '') {
    return String(s).replace(
        /[&<>'"]/g,
        c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[c])
    );
}

function render() {
    const q = search.value.toLowerCase().trim();
    const cat = category.value;

    const items = PRODUCTS.filter(p =>
        (cat === 'all' || p.category === cat) &&
        `${p.name} ${p.short} ${p.category}`
            .toLowerCase()
            .includes(q)
    );

    grid.innerHTML = items.map(p => `
        <article class="card">
            <div class="cover">${esc(p.name)}</div>

            <div class="card-body">
                <span class="tag">${esc(p.category)}</span>

                <h3>${esc(p.name)}</h3>

                <p>${esc(p.short)}</p>

                <div class="price">${esc(p.price)}</div>

                <div class="card-actions">

                    <button
                        type="button"
                        onclick="details('${esc(p.id)}')">
                        Details
                    </button>

                    ${
                        p.status === 'service' && p.checkoutUrl

                        ? `<a class="buy"
                              href="${esc(p.checkoutUrl)}">
                              Enquire
                           </a>`

                        : p.paymentEnabled

                        ? `<button
                              type="button"
                              class="buy"
                              onclick="startPayment('${esc(p.id)}')">
                              Buy now
                           </button>`

                        : `<a
                              class="buy disabled"
                              href="#"
                              aria-disabled="true">
                              Secure delivery setup
                           </a>`
                    }

                </div>
            </div>
        </article>
    `).join('');

    document.querySelector('#empty').hidden = items.length > 0;
}

function details(id) {
    const p = PRODUCTS.find(x => x.id === id);

    if (!p) {
        alert('Product not found.');
        return;
    }

    content.innerHTML = `
        <span class="tag">${esc(p.category)}</span>

        <h2>${esc(p.name)}</h2>

        <p>${esc(p.description)}</p>

        <h3>What's included</h3>

        <ul>
            ${p.features.map(f => `<li>${esc(f)}</li>`).join('')}
        </ul>

        <div class="price">${esc(p.price)}</div>

        ${
            p.status === 'service' && p.checkoutUrl

            ? `<a class="btn primary"
                  href="${esc(p.checkoutUrl)}">
                  Send enquiry
               </a>`

            : p.paymentEnabled

            ? `<button
                  type="button"
                  class="btn primary"
                  onclick="startPayment('${esc(p.id)}')">
                  Proceed to secure checkout
               </button>`

            : `<p class="notice">
                  Secure delivery is being configured for this product.
                  Checkout will activate after its private buyer files
                  are uploaded and tested.
               </p>`
        }
    `;

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
}

window.details = details;

document.querySelector('#close').onclick = closeModal;

modal.onclick = e => {
    if (e.target === modal) {
        closeModal();
    }
};

function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
}

search.oninput = render;
category.onchange = render;


// -------------------------------------------------------
// Secure checkout modal
// -------------------------------------------------------

const checkoutModal = document.querySelector('#checkout-modal');
const checkoutForm = document.querySelector('#checkout-form');
const checkoutClose = document.querySelector('#checkout-close');
const checkoutEmail = document.querySelector('#checkout-email');
const checkoutCurrency = document.querySelector('#checkout-currency');
const checkoutProductName = document.querySelector('#checkout-product-name');
const checkoutError = document.querySelector('#checkout-error');
const checkoutSubmit = document.querySelector('#checkout-submit');

let selectedProductId = null;

function startPayment(productId) {
    const product = PRODUCTS.find(p => p.id === productId);

    if (!product) {
        alert('Product information could not be found.');
        return;
    }

    selectedProductId = productId;

    checkoutProductName.textContent =
        `${product.name} — ${product.price}`;

    checkoutEmail.value = '';
    checkoutCurrency.value = 'NGN';

    checkoutError.hidden = true;
    checkoutError.textContent = '';

    checkoutSubmit.disabled = false;
    checkoutSubmit.textContent = 'Continue to secure payment';

    checkoutModal.hidden = false;
    document.body.style.overflow = 'hidden';

    setTimeout(() => checkoutEmail.focus(), 50);
}

function closeCheckout() {
    checkoutModal.hidden = true;
    document.body.style.overflow = '';
    selectedProductId = null;
}

checkoutClose.addEventListener('click', closeCheckout);

checkoutModal.addEventListener('click', function (event) {
    if (event.target === checkoutModal) {
        closeCheckout();
    }
});

checkoutForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const email = checkoutEmail.value.trim();
    const currency = checkoutCurrency.value;

    checkoutError.hidden = true;
    checkoutError.textContent = '';

    if (!selectedProductId) {
        checkoutError.textContent =
            'No product has been selected. Please close this window and try again.';
        checkoutError.hidden = false;
        return;
    }

    if (!email || !checkoutEmail.checkValidity()) {
        checkoutError.textContent =
            'Please enter a valid email address.';
        checkoutError.hidden = false;
        checkoutEmail.focus();
        return;
    }

    if (!['NGN', 'USD'].includes(currency)) {
        checkoutError.textContent =
            'Please select a valid payment currency.';
        checkoutError.hidden = false;
        return;
    }

    checkoutSubmit.disabled = true;
    checkoutSubmit.textContent = 'Opening secure payment…';

    try {
        const response = await fetch('/api/initialize-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                productId: selectedProductId,
                currency: currency
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || 'Unable to initialize payment.'
            );
        }

        if (!data.authorization_url) {
            throw new Error(
                'Paystack checkout URL was not returned.'
            );
        }

        // This exact redirect method has already been verified
        // successfully with the Paystack initialization endpoint.
        window.location.href = data.authorization_url;

    } catch (error) {
        console.error('Payment initialization error:', error);

        checkoutError.textContent =
            'We could not open the secure payment page. Please try again.';

        checkoutError.hidden = false;

        checkoutSubmit.disabled = false;
        checkoutSubmit.textContent = 'Continue to secure payment';
    }
});

window.startPayment = startPayment;

/* -------------------------------------------------------
   INITIAL PRODUCT RENDER
------------------------------------------------------- */

render();



