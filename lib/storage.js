'use strict';
const blob = require('@vercel/blob');
module.exports = {
  list: cursor => blob.list({ cursor, limit: 1000, token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(10000) }),
  head: path => blob.head(path, { token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(10000) }),
  get: path => blob.get(path, { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(120000) })
};
