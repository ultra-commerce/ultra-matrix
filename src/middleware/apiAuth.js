const { Shop, ShopSettings, ApiKey } = require('../services/database');

/**
 * Middleware: verify API key for agent/external access
 * Supports:
 *   - Header: Authorization: Bearer um_xxxxx
 *   - Header: X-API-Key: um_xxxxx
 *   - Query:  ?api_key=um_xxxxx
 */
async function verifyApiKey(req, res, next) {
  try {
    let apiKey = null;

    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7);
    }

    // Check X-API-Key header
    if (!apiKey) {
      apiKey = req.headers['x-api-key'];
    }

    // Check query parameter
    if (!apiKey) {
      apiKey = req.query.api_key;
    }

    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        code: 'AUTH_REQUIRED',
        hint: 'Pass your API key via Authorization: Bearer <key>, X-API-Key header, or ?api_key= query param'
      });
    }

    // Check against static env key first (for quick personal use)
    if (apiKey === process.env.ULTRA_MATRIX_API_KEY) {
      const shop = await Shop.findFirst();

      if (!shop) {
        return res.status(403).json({
          error: 'No shop installed. Please install the app on your Shopify store first.',
          code: 'NO_SHOP'
        });
      }

      shop.settings = await ShopSettings.findByShopId(shop.id);
      req.shop = shop;
      req.shopDomain = shop.shopDomain;
      req.accessToken = shop.accessToken;
      req.authMethod = 'env_api_key';
      return next();
    }

    // Check against database API keys (for SaaS multi-tenant)
    const keyRecord = await ApiKey.findByKey(apiKey);

    if (!keyRecord || !keyRecord.isActive) {
      return res.status(401).json({
        error: 'Invalid or inactive API key',
        code: 'INVALID_KEY'
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
    res.status(500).json({
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
}

module.exports = { verifyApiKey };
