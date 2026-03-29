const crypto = require('crypto');
const { Shop, ShopSettings } = require('../services/database');

/**
 * Get API credentials - works with both:
 * 1. Shopify CLI (sets SHOPIFY_API_KEY & SHOPIFY_API_SECRET automatically)
 * 2. Manual .env config
 */
function getApiKey() {
  return process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID || '';
}

function getApiSecret() {
  return process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '';
}

function getHost() {
  return process.env.HOST || process.env.SHOPIFY_APP_URL || 'http://localhost:3000';
}

function getScopes() {
  return process.env.SCOPES || process.env.SHOPIFY_SCOPES || 'read_content,write_content';
}

/**
 * Verify Shopify HMAC signature
 */
function verifyHmac(query) {
  const { hmac, ...params } = query;
  if (!hmac) return false;

  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  const calculated = crypto
    .createHmac('sha256', getApiSecret())
    .update(sortedParams)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculated, 'hex'),
      Buffer.from(hmac, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Verify Shopify webhook HMAC
 */
function verifyWebhookHmac(body, hmacHeader) {
  const calculated = crypto
    .createHmac('sha256', getApiSecret())
    .update(body)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculated),
      Buffer.from(hmacHeader)
    );
  } catch {
    return false;
  }
}

/**
 * Middleware: verify Shopify session via cookie
 */
async function verifyShopifySession(req, res, next) {
  try {
    const shopDomain = req.cookies?.shopDomain || req.query?.shop;

    if (!shopDomain) {
      if (req.query?.shop) {
        return res.redirect(`/auth?shop=${req.query.shop}`);
      }
      return res.status(401).render('install', {
        apiKey: getApiKey()
      });
    }

    const shop = await Shop.withSettings(shopDomain);

    if (!shop) {
      return res.redirect(`/auth?shop=${shopDomain}`);
    }

    req.shop = shop;
    req.shopDomain = shopDomain;
    req.accessToken = shop.accessToken;
    next();
  } catch (error) {
    console.error('Session verification error:', error);
    next(error);
  }
}

/**
 * Shopify OAuth helpers
 */
function buildAuthUrl(shop) {
  const scopes = getScopes();
  const redirectUri = `${getHost()}/auth/callback`;
  const nonce = crypto.randomBytes(16).toString('hex');

  return {
    url: `https://${shop}/admin/oauth/authorize?client_id=${getApiKey()}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`,
    nonce
  };
}

async function exchangeToken(shop, code) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: getApiKey(),
      client_secret: getApiSecret(),
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.statusText}`);
  }

  return response.json();
}

module.exports = {
  verifyHmac,
  verifyWebhookHmac,
  verifyShopifySession,
  buildAuthUrl,
  exchangeToken,
  getApiKey,
  getApiSecret,
  getHost,
  getScopes,
};
