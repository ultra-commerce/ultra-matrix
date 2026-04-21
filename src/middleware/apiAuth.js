const { Shop, ShopSettings, ApiKey } = require('../services/database');
const { checkPlanLimit } = require('../services/billing');

/**
 * Middleware: verify API key for agent/external access
 */
async function verifyApiKey(req, res, next) {
  try {
    let apiKey = null;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7);
    }

    if (!apiKey) apiKey = req.headers['x-api-key'];
    if (!apiKey) apiKey = req.query.api_key;

    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        code: 'AUTH_REQUIRED',
        hint: 'Pass your API key via Authorization: Bearer <key>, X-API-Key header, or ?api_key= query param',
      });
    }

    // Check static env key first
    if (apiKey === process.env.ULTRA_MATRIX_API_KEY) {
      const shop = await Shop.findFirst();
      if (!shop) {
        return res.status(403).json({
          error: 'No shop installed. Please install the app on your Shopify store first.',
          code: 'NO_SHOP',
        });
      }

      const settings = await ShopSettings.findByShopId(shop.id);
      shop.settings = settings;
      req.shop = shop;
      req.shopDomain = shop.shopDomain;
      req.accessToken = shop.accessToken;
      req.authMethod = 'env_api_key';
      return next();
    }

    // Check database API keys
    const keyRecord = await ApiKey.findByKey(apiKey);

    if (!keyRecord || !keyRecord.isActive) {
      return res.status(401).json({
        error: 'Invalid or inactive API key',
        code: 'INVALID_KEY',
      });
    }

    // Update last used
    await ApiKey.update(keyRecord.id, { lastUsedAt: new Date().toISOString() });

    req.shop = keyRecord.shop;
    req.shopDomain = keyRecord.shop.shopDomain;
    req.accessToken = keyRecord.shop.accessToken;
    req.authMethod = 'database_api_key';
    req.apiKeyRecord = keyRecord;
    next();
  } catch (error) {
    console.error('API auth error:', error);
    res.status(500).json({ error: 'Authentication failed', code: 'AUTH_ERROR' });
  }
}

/**
 * Middleware: enforce plan limits on import/export
 */
function enforcePlanLimits(req, res, next) {
  // Plan limits are checked at job processing time, not at enqueue time
  // This middleware can be used for pre-flight checks if desired
  next();
}

module.exports = { verifyApiKey, enforcePlanLimits };
