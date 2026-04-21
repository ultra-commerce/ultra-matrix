const express = require('express');
const router = express.Router();
const { Job } = require('../services/database');
const { getQueueStats } = require('../services/jobQueue');
const { getPlan, PLANS } = require('../services/billing');
const ShopifyAPI = require('../services/shopifyApi');

// GET / - Main dashboard
router.get('/', async (req, res) => {
  try {
    const shop = req.shop;
    const shopify = new ShopifyAPI(shop.shopDomain, shop.accessToken);

    const [recentJobs, totalJobs, completedJobs, failedJobs, processingJobs, queuedJobs, queueStats] = await Promise.all([
      Job.findMany({ shopId: shop.id, take: 5 }),
      Job.count({ shopId: shop.id }),
      Job.count({ shopId: shop.id, status: 'completed' }),
      Job.count({ shopId: shop.id, status: 'failed' }),
      Job.count({ shopId: shop.id, status: 'processing' }),
      Job.count({ shopId: shop.id, status: 'queued' }),
      getQueueStats().catch(() => ({})),
    ]);

    let shopInfo = null;
    try {
      shopInfo = await shopify.getShopInfo();
    } catch (e) {
      console.error('Could not fetch shop info:', e.message);
    }

    const plan = getPlan(shop.plan || 'free');

    res.render('dashboard', {
      page: 'home',
      shop,
      shopInfo,
      recentJobs,
      stats: { totalJobs, completedJobs, failedJobs, processingJobs, queuedJobs },
      queueStats,
      plan,
      shopDomain: shop.shopDomain,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', { message: error.message });
  }
});

// GET /plan - Plan selection page
router.get('/plan', async (req, res) => {
  try {
    res.render('plan', {
      page: 'plan',
      shop: req.shop,
      shopDomain: req.shop.shopDomain,
      plans: PLANS,
      changed: req.query.changed,
      declined: req.query.declined,
      error: req.query.error,
    });
  } catch (error) {
    res.status(500).render('error', { message: error.message });
  }
});

module.exports = router;
