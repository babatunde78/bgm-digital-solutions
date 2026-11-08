'use strict';
const list = document.querySelector('#campus-product-list');
if (list) {
  const productImages = new Map([
    ['campus-bursary-package-a', 'campus-bursary-a'],
    ['campus-bursary-package-b', 'campus-bursary-b'],
    ['campus-bursary-full-excel', 'campus-bursary-full-excel']
  ]);
  const productIds = [...productImages.keys()];
  const addText = (parent, tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    parent.append(node);
    return node;
  };
  fetch('/api/catalog', { cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error('Catalogue unavailable');
    return response.json();
  }).then(({ products }) => {
    if (!Array.isArray(products)) throw new Error('Invalid catalogue');
    const campusProducts = products.filter(product => productIds.includes(product.id))
      .sort((a, b) => productIds.indexOf(a.id) - productIds.indexOf(b.id));
    if (!campusProducts.length) {
      list.replaceChildren();
      addText(list, 'p', 'notice', 'Campus Excel packages are not currently available for purchase.');
      const enquiry = document.createElement('a');
      enquiry.className = 'text-link';
      enquiry.href = 'https://wa.me/2349031921294?text=' + encodeURIComponent('Hello BGM, I would like to ask about Campus Bursary Excel packages.');
      enquiry.target = '_blank';
      enquiry.rel = 'noopener noreferrer';
      enquiry.textContent = 'Request a pilot quote ↗';
      list.append(enquiry);
      list.setAttribute('aria-busy', 'false');
      return;
    }
    list.replaceChildren();
    for (const product of campusProducts) {
      const card = document.createElement('article');
      card.className = 'campus-product-card';
      const image = document.createElement('img');
      image.className = 'campus-product-art';
      image.src = `assets/${productImages.get(product.id)}.jpg`;
      image.alt = `${product.name} — illustrative product mockup`;
      image.width = 1200;
      image.height = 800;
      image.loading = 'lazy';
      image.decoding = 'async';
      card.append(image);
      addText(card, 'p', 'campus-status', product.paymentEnabled ? 'Available · Secure NGN checkout' : 'Request a pilot quote');
      addText(card, 'h3', '', product.name);
      addText(card, 'p', 'campus-product-lead', product.short);
      addText(card, 'p', '', product.description);
      if (product.price) addText(card, 'p', 'price', `First year: ${product.price}`);
      if (product.usdReference && product.usdRateDate) {
        addText(card, 'p', 'small', `US$${product.usdReference} approximate equivalent · reference rate dated ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(product.usdRateDate + 'T00:00:00Z'))}. Checkout is in NGN.`);
      }
      const heading = addText(card, 'h4', '', 'Included');
      const features = document.createElement('ul');
      features.setAttribute('aria-labelledby', `scope-${product.id}`);
      heading.id = `scope-${product.id}`;
      for (const feature of product.features) addText(features, 'li', '', feature);
      card.append(features);
      const action = document.createElement('a');
      action.className = 'text-link';
      if (product.paymentEnabled) {
        action.href = `product.html?id=${encodeURIComponent(product.id)}`;
        action.textContent = 'View details and buy';
      } else {
        action.href = `https://wa.me/2349031921294?text=${encodeURIComponent(`Hello BGM, I would like to ask about ${product.name}.`)}`;
        action.target = '_blank';
        action.rel = 'noopener noreferrer';
        action.textContent = 'Request a pilot quote ↗';
      }
      card.append(action);
      list.append(card);
    }
    list.setAttribute('aria-busy', 'false');
  }).catch(() => {
    list.replaceChildren();
    addText(list, 'p', 'notice', 'Campus Bursary prices are temporarily unavailable. Please try again or contact BGM for help.');
    list.setAttribute('aria-busy', 'false');
  });
}
