'use strict';
const { endpoint } = require('../lib/http');
const { emailEnabled } = require('../lib/config');
module.exports = endpoint('GET', async (req, res) => res.status(200).json({ emailEnabled: emailEnabled() }));
