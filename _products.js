// SERVER-SIDE PRICE CATALOGUE — never accept price/amount from the browser.
// amount is in kobo: NGN 5,000 = 500000. Change values before enabling products.
module.exports = {
  "500-business-prompts": { name: "500 ChatGPT Prompts for Business Owners", amount: 0, currency: "NGN", enabled: false },
  "pdf-automation-starter": { name: "PDF Automation Business Starter", amount: 0, currency: "NGN", enabled: false },
  "invoice-extraction": { name: "Invoice Data Extraction Toolkit", amount: 0, currency: "NGN", enabled: false }
};
