'use strict';
const blob = require('@vercel/blob');
module.exports = {
  head: path => blob.head(path, { token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(10000) }),
  get: path => blob.get(path, { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(120000) })
};
