const express = require('express');
const router = express.Router();
const { Job } = require('../services/database');
const ShopifyAPI = require('../services/shopifyApi');

// GET / - Main dashboard (Ultra Matrix home)
router.get('/', async (req, res) => {
  try {
    const shop = req.shop;
    const shopify = new ShopifyAPI(shop.shopDomain, shop.accessToken);

    const recentJobs = await Job.findMany({ shopId: shop.id, take: 5 });
    const totalJobs = await Job.count({ shopId: shop.id });
    const completedJobs = await Job.count({ shopId: shop.id, status: 'completed' });
    const failedJobs = await Job.count({ shopId: shop.id, status: 'failed' });
    const processingJobs = await Job.count({ shopId: shop.id, status: 'processing' });

    let shopInfo = null;
    try {
      shopInfo = await shopify.getShopInfo();
    } catch (e) {
      console.error('Could not fetch shop info:', e.message);
    }

    res.render('dashboard', {
      page: 'home',
      shop,
      shopInfo,
      recentJobs,
      stats: { totalJobs, completedJobs, failedJobs, processingJobs },
      shopDomain: shop.shopDomain,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', { message: error.message });
  }
});

router.get('/plan', async (req, res) => {
  try {
    res.render('plan', {
      page: 'plan',
      shop: req.shop,
      shopDomain: req.shop.shopDomain,
    });
  } catch (error) {
    res.status(500).render('error', { message: error.message });
  }
});

module.exports = router;
