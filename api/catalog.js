'use strict';
const { endpoint } = require('../lib/http');
const { getPublicProducts } = require('../lib/catalog');
module.exports = endpoint('GET', async (req, res) => res.status(200).json({ products: await getPublicProducts() }));
