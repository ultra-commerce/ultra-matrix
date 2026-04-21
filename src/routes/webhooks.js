/**
 * Webhook Routes
 * Handles Shopify mandatory webhooks including GDPR compliance
 */

const express = require('express');
const router = express.Router();
const { Shop, ShopSettings, Job, ApiKey, SessionStore } = require('../services/database');
const { verifyWebhookHmac } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * Verify webhook middleware
 */
function verifyWebhook(req, res, next) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac || !verifyWebhookHmac(req.body, hmac)) {
    logger.warn('Webhook HMAC verification failed');
    return res.status(401).send('Unauthorized');
  }
  next();
}

// ─── APP LIFECYCLE ────────────────────────────────────

// App uninstalled
router.post('/app/uninstalled', verifyWebhook, async (req, res) => {
  try {
    const shopDomain = req.headers['x-shopify-shop-domain'];
    logger.info(`App uninstalled for ${shopDomain}`);

    if (shopDomain) {
      const shop = await Shop.findUnique(shopDomain);
      if (shop) {
        // Clean up all shop data
        await ApiKey.deleteByShopId(shop.id);
        await ShopSettings.deleteByShopId(shop.id);
        await Job.deleteByShopId(shop.id);
        await SessionStore.deleteByShopId(shop.id);
        await Shop.delete(shop.id);
        logger.info(`Cleaned up all data for ${shopDomain}`);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('App uninstall webhook error:', error);
    res.status(200).send('OK'); // Always return 200 for webhooks
  }
});

// Subscription billing updated
router.post('/app/subscriptions/update', verifyWebhook, async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const shopDomain = req.headers['x-shopify-shop-domain'];
    logger.info(`Subscription updated for ${shopDomain}:`, payload);

    // If subscription was cancelled by Shopify/merchant, downgrade to free
    if (payload.app_subscription?.status === 'cancelled' ||
        payload.app_subscription?.status === 'declined' ||
        payload.app_subscription?.status === 'expired') {
      const shop = await Shop.findUnique(shopDomain);
      if (shop) {
        await Shop.update(shop.id, { plan: 'free', chargeId: null, planExpiresAt: null });
        logger.info(`Downgraded ${shopDomain} to free due to subscription ${payload.app_subscription?.status}`);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Subscription webhook error:', error);
    res.status(200).send('OK');
  }
});

// ─── GDPR MANDATORY WEBHOOKS ──────────────────────────
// Required for Shopify App Store approval

// Customer data request (customers/data_request)
// Shopify sends this when a customer requests their data under GDPR
router.post('/customers/data_request', verifyWebhook, async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const shopDomain = payload.shop_domain;
    const customerEmail = payload.customer?.email;
    const ordersRequested = payload.orders_requested || [];

    logger.info(`GDPR data request for ${customerEmail} from ${shopDomain}`);

    // Ultra Matrix doesn't store customer PII beyond what's in Shopify.
    // Log the request for compliance records.
    // In production, you'd email the store owner or enqueue a data export.

    res.status(200).json({
      message: 'Data request received. Ultra Matrix does not store customer personal data beyond job processing metadata.',
    });
  } catch (error) {
    logger.error('GDPR data request error:', error);
    res.status(200).send('OK');
  }
});

// Customer data erasure (customers/redact)
// Shopify sends this when a customer requests deletion under GDPR
router.post('/customers/redact', verifyWebhook, async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const shopDomain = payload.shop_domain;
    const customerEmail = payload.customer?.email;

    logger.info(`GDPR customer redact for ${customerEmail} from ${shopDomain}`);

    // Ultra Matrix doesn't store customer PII separately.
    // Any customer data in CSV uploads is temporary and cleaned up after processing.
    // Log for compliance.

    res.status(200).json({
      message: 'Customer redact request processed. No persistent customer PII stored.',
    });
  } catch (error) {
    logger.error('GDPR customer redact error:', error);
    res.status(200).send('OK');
  }
});

// Shop data erasure (shop/redact)
// Shopify sends this 48 hours after an app is uninstalled
router.post('/shop/redact', verifyWebhook, async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const shopDomain = payload.shop_domain;

    logger.info(`GDPR shop redact for ${shopDomain}`);

    // Ensure all shop data is deleted (should already be done by uninstall webhook)
    const shop = await Shop.findUnique(shopDomain);
    if (shop) {
      await ApiKey.deleteByShopId(shop.id);
      await ShopSettings.deleteByShopId(shop.id);
      await Job.deleteByShopId(shop.id);
      await SessionStore.deleteByShopId(shop.id);
      await Shop.delete(shop.id);
      logger.info(`All data erased for ${shopDomain}`);
    }

    res.status(200).json({ message: 'Shop data erased' });
  } catch (error) {
    logger.error('GDPR shop redact error:', error);
    res.status(200).send('OK');
  }
});

module.exports = router;
