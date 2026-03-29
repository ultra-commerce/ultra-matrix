const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { ShopSettings, ApiKey } = require('../services/database');

// GET /settings
router.get('/', async (req, res) => {
  try {
    const shop = req.shop;
    const settings = await ShopSettings.findByShopId(shop.id) || {};
    const apiKeys = await ApiKey.findByShopId(shop.id);

    res.render('settings', {
      page: 'settings',
      shop,
      settings,
      apiKeys,
      envApiKey: process.env.ULTRA_MATRIX_API_KEY ? '••••••' + process.env.ULTRA_MATRIX_API_KEY.slice(-6) : null,
      shopDomain: shop.shopDomain,
    });
  } catch (error) {
    res.status(500).render('error', { message: error.message });
  }
});

// POST /settings
router.post('/', async (req, res) => {
  try {
    const shop = req.shop;
    const { allowExternalDownload, notifyOnComplete, notifyEmail, defaultBlogHandle } = req.body;

    await ShopSettings.upsert(shop.id, {
      allowExternalDownload: allowExternalDownload === 'on',
      notifyOnComplete: notifyOnComplete === 'on',
      notifyEmail: notifyEmail || null,
      defaultBlogHandle: defaultBlogHandle || 'news',
    });

    res.redirect('/settings?saved=1');
  } catch (error) {
    res.status(500).render('error', { message: error.message });
  }
});

// POST /settings/api-keys
router.post('/api-keys', async (req, res) => {
  try {
    const shop = req.shop;
    const { name } = req.body;
    const key = `um_${crypto.randomBytes(24).toString('hex')}`;

    const apiKey = await ApiKey.create({
      shopId: shop.id,
      name: name || 'API Key',
      key,
    });

    res.redirect(`/settings?newKey=${key}&keyName=${encodeURIComponent(apiKey.name)}`);
  } catch (error) {
    res.status(500).render('error', { message: error.message });
  }
});

// POST /settings/api-keys/:id/revoke
router.post('/api-keys/:id/revoke', async (req, res) => {
  try {
    await ApiKey.update(req.params.id, { isActive: 0 });
    res.redirect('/settings');
  } catch (error) {
    res.status(500).render('error', { message: error.message });
  }
});

// POST /settings/api-keys/:id/delete
router.post('/api-keys/:id/delete', async (req, res) => {
  try {
    await ApiKey.delete(req.params.id);
    res.redirect('/settings');
  } catch (error) {
    res.status(500).render('error', { message: error.message });
  }
});

module.exports = router;
