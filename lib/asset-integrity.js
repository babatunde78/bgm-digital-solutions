'use strict';
const { createHash } = require('node:crypto');

function assetDigest(bytes, text) {
  const content = text ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes;
  return createHash('sha256').update(content).digest('hex');
}

module.exports = { assetDigest };
