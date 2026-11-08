'use strict';
const source = require('./campus-prices.json');
const priceBook = structuredClone(source);
function quote(packageId) {
  if (!Object.hasOwn(source.packages, packageId)) throw new RangeError('Unknown package');
  const entry = source.packages[packageId];
  return structuredClone({ packageId, priceVersion: source.version, currency: source.currency,
    billing: source.billing, ...entry, firstYearKobo: entry.annualKobo + entry.setupKobo,
    reference: source.reference, publication: source.publication, effectiveFrom: source.effectiveFrom });
}
function usdEquivalent(kobo) {
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new RangeError('Expected nonnegative integer kobo');
  const rate = BigInt(source.reference.ngnPerUsdHundredths);
  const cents = (BigInt(kobo) * 100n + rate / 2n) / rate;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
module.exports = { priceBook, quote, usdEquivalent };
