'use strict';
const { endpoint, sameOrigin, setSession } = require('../lib/http');
module.exports = endpoint('POST', async (req, res) => {
  sameOrigin(req); setSession(req, res);
  return res.status(200).json({ ready: true });
});
