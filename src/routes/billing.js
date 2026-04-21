/**
 * Billing Routes
 * Handles plan selection, Shopify charge creation, and callbacks
 */

const express = require('express');
const router = express.Router();
const { createCharge, handleBillingCallback, cancelSubscription, PLANS } = require('../services/billing');
const logger = require('../utils/logger');

// POST /billing/subscribe - Start subscription flow
router.post('/subscribe', async (req, res) => {
  try {
    const { plan } = req.body;

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan', validPlans: Object.keys(PLANS) });
    }

    const result = await createCharge(req.shopDomain, req.accessToken, plan);

    if (result.free) {
      // Downgrade to free — no charge needed
      if (req.headers.accept?.includes('application/json')) {
        return res.json({ success: true, plan: 'free' });
      }
      return res.redirect('/plan?changed=free');
    }

    if (result.url) {
      // Redirect to Shopify's charge approval page
      if (req.headers.accept?.includes('application/json')) {
        return res.json({ success: true, confirmationUrl: result.url });
      }
      return res.redirect(result.url);
    }

    res.status(500).json({ error: 'Failed to create charge' });
  } catch (error) {
    logger.error('Subscribe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /billing/callback - Shopify redirects here after charge approval/decline
router.get('/callback', async (req, res) => {
  try {
    const { charge_id, shop, plan } = req.query;

    if (!charge_id || !shop || !plan) {
      return res.redirect('/plan?error=missing_params');
    }

    const { Shop: ShopModel } = require('../services/database');
    const shopRecord = await ShopModel.findUnique(shop);

    if (!shopRecord) {
      return res.redirect('/plan?error=shop_not_found');
    }

    const result = await handleBillingCallback(shop, shopRecord.accessToken, charge_id, plan);

    if (result.success) {
      logger.info(`${shop} upgraded to ${plan}`);
      return res.redirect(`/plan?changed=${plan}`);
    } else {
      return res.redirect(`/plan?declined=true`);
    }
  } catch (error) {
    logger.error('Billing callback error:', error);
    res.redirect('/plan?error=callback_failed');
  }
});

// POST /billing/cancel - Cancel current subscription
router.post('/cancel', async (req, res) => {
  try {
    await cancelSubscription(req.shopDomain, req.accessToken);

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, plan: 'free' });
    }
    res.redirect('/plan?changed=free');
  } catch (error) {
    logger.error('Cancel error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
