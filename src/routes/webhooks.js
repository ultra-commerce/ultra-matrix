const express = require('express');
const router = express.Router();
const { Shop, ShopSettings, Job, ApiKey } = require('../services/database');
const { verifyWebhookHmac } = require('../middleware/auth');

router.post('/app/uninstalled', async (req, res) => {
  try {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    if (!hmac || !verifyWebhookHmac(req.body, hmac)) {
      return res.status(401).send('Unauthorized');
    }

    const shopDomain = req.headers['x-shopify-shop-domain'];
    if (shopDomain) {
      const shop = await Shop.findUnique(shopDomain);
      if (shop) {
        await ApiKey.deleteByShopId(shop.id);
        await ShopSettings.deleteByShopId(shop.id);
        await Job.deleteByShopId(shop.id);
        await Shop.delete(shop.id);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK');
  }
});

module.exports = router;
