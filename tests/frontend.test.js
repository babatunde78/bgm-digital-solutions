'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
test('catalogue strings cannot inject HTML or inline JavaScript and currencies follow the product',()=>{
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://store.example',runScripts:'outside-only'});
  const {window}=dom;
  window.PRODUCTS=[{id:"bad');alert(1)//",name:'<img src=x onerror=alert(1)>',category:'<script>bad</script>',short:'Test',description:'Guide',features:['<b>safe</b>'],price:'NGN 7,500',amounts:{NGN:750000},paymentEnabled:true,status:'live'}];
  window.eval(fs.readFileSync('app.js','utf8'));
  assert.equal(window.document.querySelector('#product-grid img'),null);
  assert.equal(window.document.querySelector('#product-grid [onclick]'),null);
  assert.match(window.document.querySelector('.cover').textContent,/<img/);
  window.document.querySelector('.buy').click();
  assert.equal(window.document.querySelector('#checkout-modal').hidden,false);
  assert.equal(window.document.querySelectorAll('#checkout-currency option').length,1);
  assert.equal(window.document.querySelector('#checkout-currency').value,'NGN');
  window.document.querySelector('#checkout-close').click();assert.equal(window.document.querySelector('#checkout-modal').hidden,true);
  dom.window.close();
});
test('store and purchase support links use the supplied WhatsApp number',()=>{
  for(const file of ['index.html','payment-success.html']){
    const dom=new JSDOM(fs.readFileSync(file,'utf8'));
    const links=[...dom.window.document.querySelectorAll('a[href^="https://wa.me/"]')];
    assert(links.length>0);
    for(const link of links){assert.equal(new URL(link.href).pathname,'/2349031921294');assert.match(link.rel,/noopener/)}
    assert.equal(dom.window.document.querySelectorAll('script:not([src])').length,0);
    dom.window.close();
  }
});
