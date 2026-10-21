
const PRODUCTS = require('./_products');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const { email, productId, currency = 'NGN' } = req.body || {};

    const normalizedCurrency = String(currency).toUpperCase();

    if (
      typeof email !== 'string' ||
      !/^\S+@\S+\.\S+$/.test(email.trim())
    ) {
      return res.status(400).json({
        error: 'A valid email address is required.'
      });
    }

    const product = PRODUCTS[productId];

    if (!product || !product.enabled) {
      return res.status(400).json({
        error: 'Product is not available.'
      });
    }

    if (!product.deliveryReady) {
      return res.status(400).json({
        error: 'Secure delivery for this product is not active yet.'
      });
    }

    const amount = product.amounts?.[normalizedCurrency];

    if (!Number.isInteger(amount) || amount < 100) {
      return res.status(400).json({
        error: 'This currency is not available for the selected product.'
      });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      console.error('Paystack secret key is missing');

      return res.status(500).json({
        error: 'Payment service is not configured.'
      });
    }

    const origin = (
      process.env.SITE_URL ||
      `https://${req.headers.host}`
    ).replace(/\/+$/, '');

    const response = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          amount: String(amount),
          currency: normalizedCurrency,
          callback_url: `${origin}/payment-success.html`,
          metadata: JSON.stringify({
            product_id: productId,
            product_name: product.name,
            delivery: 'bgm-private-blob'
          })
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      console.error('Paystack initialization failed', {
        statusCode: response.status,
        message: data.message
      });

      return res.status(502).json({
        error: 'Payment initialization failed. Please try again.'
      });
    }

    if (!data.data?.authorization_url || !data.data?.reference) {
      console.error('Paystack returned incomplete checkout data');

      return res.status(502).json({
        error: 'Payment service returned an incomplete response.'
      });
    }

    return res.status(200).json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference
    });

  } catch (error) {
    console.error('Payment initialization exception', {
      message: error.message
    });

    return res.status(500).json({
      error: 'Unable to initialize payment.'
    });
  }
};

