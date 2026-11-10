'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assetDigest } = require('../lib/asset-integrity');

test('text asset integrity ignores checkout line-ending conversion', () => {
  const committed = Buffer.from('<html>\n<body>ok</body>\n</html>\n');
  const checkedOut = Buffer.from('<html>\r\n<body>ok</body>\r\n</html>\r\n');
  assert.equal(assetDigest(committed, true), assetDigest(checkedOut, true));
});

test('binary asset integrity preserves every byte', () => {
  const original = Buffer.from([0x01, 0x0a, 0x02]);
  const changed = Buffer.from([0x01, 0x0d, 0x0a, 0x02]);
  assert.notEqual(assetDigest(original, false), assetDigest(changed, false));
});
