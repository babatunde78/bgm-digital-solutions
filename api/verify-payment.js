const { verifyTransaction } = require('./_paystack');
const { sign } = require('./_delivery-token');
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const reference = String(req.query.reference || '');
  if (!/^[A-Za-z0-9.=-]+$/.test(reference)) return res.status(400).json({error:'Invalid reference.'});
  try {
    const v = await verifyTransaction(reference);
    if (!v.valid || !v.product.deliveryReady || !v.product.blobPathnames?.length) {
      return res.status(400).json({verified:false,error:'Payment could not be verified for a deliverable product.'});
    }
    const email = String(v.data.customer?.email || '').toLowerCase();
    const token = sign({
      reference:v.data.reference,
      productId:v.metadata.product_id,
      email,
      exp:Date.now()+10*60*1000
    });
    return res.status(200).json({
      verified:true,
      reference:v.data.reference,
      product:{id:v.metadata.product_id,name:v.product.name},
      customerEmail:email,
      downloadUrl:`/api/download?token=${encodeURIComponent(token)}`,
      expiresInSeconds:600
    });
  } catch(e) {
    return res.status(500).json({verified:false,error:'Verification service unavailable.'});
  }
}
