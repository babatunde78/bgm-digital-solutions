const {getPublicProducts}=require('./_catalog');
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');try{return res.status(200).json({products:await getPublicProducts()})}catch(e){console.error('Catalogue unavailable',e.message);return res.status(503).json({error:'Catalogue temporarily unavailable'})}};
