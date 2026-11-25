'use strict';
const menu = document.querySelector('.menu');
const navigation = document.querySelector('#site-nav');
if (menu && navigation) {
  if (!navigation.querySelector('a[href="/campus-bursary.html"]')) {
    const campusLink = document.createElement('a');
    campusLink.href = '/campus-bursary.html';
    campusLink.textContent = 'Campus Bursary pilot';
    navigation.append(campusLink);
  }
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    navigation.classList.toggle('open', open);
  });
  navigation.addEventListener('click', event => {
    if (!event.target.closest('a')) return;
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open navigation');
    navigation.classList.remove('open');
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.getAttribute('aria-expanded') !== 'true') return;
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open navigation');
    navigation.classList.remove('open');
    menu.focus();
  });
}
const storeHelp = document.querySelector('#store-help');
if (storeHelp) {
  storeHelp.addEventListener('click', event => {
    if (event.target.closest('a')) storeHelp.open = false;
  });
  storeHelp.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !storeHelp.open) return;
    event.preventDefault();
    storeHelp.open = false;
    storeHelp.querySelector('summary').focus();
  });
}
const year = document.querySelector('#year');
if (year) year.textContent = new Date().getFullYear();
