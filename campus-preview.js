'use strict';
const list = document.querySelector('#campus-product-list');
if (list) {
  const addText = (parent, tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    parent.append(node);
    return node;
  };
  fetch('/campus-preview.json').then(response => {
    if (!response.ok) throw new Error('Preview information unavailable');
    return response.json();
  }).then(({ productName, products }) => {
    list.replaceChildren();
    for (const product of products) {
      const card = document.createElement('article');
      card.className = 'campus-product-card';
      addText(card, 'p', 'campus-status pilot-status', 'Pilot scope · Not available for purchase');
      addText(card, 'h3', '', product.name.replace(/^Campus Bursary/, productName));
      addText(card, 'p', 'campus-product-lead', product.short);
      addText(card, 'p', '', product.description);
      const heading = addText(card, 'h4', '', 'Included in this pilot scope');
      const features = document.createElement('ul');
      features.setAttribute('aria-labelledby', heading.id || (heading.id = `scope-${product.id}`));
      for (const feature of product.features) addText(features, 'li', '', feature);
      card.append(features);
      const enquiry = document.createElement('a');
      enquiry.className = 'text-link';
      enquiry.href = `https://wa.me/2349031921294?text=${encodeURIComponent(`Hello BGM, I would like to ask about ${productName}: ${product.name}.` )}`;
      enquiry.target = '_blank';
      enquiry.rel = 'noopener noreferrer';
      enquiry.textContent = 'Ask about this pilot ↗';
      card.append(enquiry);
      list.append(card);
    }
    list.setAttribute('aria-busy', 'false');
  }).catch(() => {
    list.replaceChildren();
    addText(list, 'p', 'notice', 'Pilot details are temporarily unavailable. Please contact BGM for information.');
    list.setAttribute('aria-busy', 'false');
  });
}
