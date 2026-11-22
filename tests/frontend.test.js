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
test('published product details expose matching Product structured data',()=>{
  const dom=new JSDOM(fs.readFileSync('product.html','utf8'),{url:'https://store.example/product.html?id=school-fee-reconciliation',runScripts:'outside-only'});
  const {window}=dom;
  window.PRODUCTS=[{id:'school-fee-reconciliation',name:'School Fee Reconciliation',category:'School Administration',short:'Allocate family payments across students and terms.',description:'A workbook for reconciling school fees.',features:['Payment allocation'],price:'NGN 7,500',amounts:{NGN:750000},paymentEnabled:true,status:'live'}];
  window.eval(fs.readFileSync('app.js','utf8'));
  const data=JSON.parse(window.document.querySelector('#product-structured-data').textContent);
  assert.equal(data['@type'],'Product');
  assert.equal(data.name,'School Fee Reconciliation');
  assert.equal(data.offers[0].priceCurrency,'NGN');
  assert.equal(data.offers[0].price,'7500.00');
  assert.equal(data.offers[0].url,window.location.href);
  assert.equal(window.document.querySelectorAll('#product-detail h1').length,1);
  dom.window.close();
});
test('product structured data omits currency offers when one URL shows multiple checkout currencies',()=>{
  const dom=new JSDOM(fs.readFileSync('product.html','utf8'),{url:'https://store.example/product.html?id=school-fee-reconciliation',runScripts:'outside-only'});
  dom.window.PRODUCTS=[{id:'school-fee-reconciliation',name:'School Fee Reconciliation',category:'School Administration',short:'Allocate family payments across students and terms.',description:'A workbook for reconciling school fees.',features:[],price:'NGN 7,500 / GHS 900',amounts:{NGN:750000,GHS:90000},paymentEnabled:true,status:'live'}];
  dom.window.eval(fs.readFileSync('app.js','utf8'));
  const data=JSON.parse(dom.window.document.querySelector('#product-structured-data').textContent);
  assert.equal(Object.hasOwn(data,'offers'),false);
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
