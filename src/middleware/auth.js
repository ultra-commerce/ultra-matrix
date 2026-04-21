const crypto = require('crypto');
const { Shop, ShopSettings } = require('../services/database');

/**
 * Get API credentials
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
  return process.env.SCOPES || process.env.SHOPIFY_SCOPES || 'read_content,write_content,read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_themes,write_themes';
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
 * Verify session token from Shopify App Bridge (for embedded apps)
 * Decodes the JWT and verifies the shop
 */
function verifySessionToken(token) {
  if (!token) return null;

  try {
    // Decode JWT (header.payload.signature)
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // Verify issuer matches Shopify
    if (!payload.iss || !payload.iss.includes('myshopify.com')) return null;

    // Verify it hasn't expired
    if (payload.exp && payload.exp < Date.now() / 1000) return null;

    // Extract shop domain from issuer
    const issUrl = new URL(payload.iss);
    const shopDomain = issUrl.hostname;

    // Verify HMAC signature
    const signatureInput = `${parts[0]}.${parts[1]}`;
    const expectedSignature = crypto
      .createHmac('sha256', getApiSecret())
      .update(signatureInput)
      .digest('base64url');

    if (expectedSignature !== parts[2]) return null;

    return {
      shopDomain,
      dest: payload.dest,
      sub: payload.sub,
      exp: payload.exp,
      nbf: payload.nbf,
      iss: payload.iss,
      jti: payload.jti,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Middleware: verify Shopify session
 * Supports both cookie-based (non-embedded) and token-based (embedded) auth
 */
async function verifyShopifySession(req, res, next) {
  try {
    let shopDomain = null;

    // Method 1: Session token (embedded app — App Bridge sends this as Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = verifySessionToken(token);
      if (decoded) {
        shopDomain = decoded.shopDomain;
      }
    }

    // Method 2: Cookie-based session (fallback, also used during OAuth)
    if (!shopDomain) {
      shopDomain = req.cookies?.shopDomain || req.query?.shop;
    }

    if (!shopDomain) {
      if (req.query?.shop) {
        return res.redirect(`/auth?shop=${req.query.shop}`);
      }
      // For API requests, return JSON error
      if (req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      return res.status(401).render('install', { apiKey: getApiKey() });
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
 * Middleware: check if the app should be embedded
 * Redirects to Shopify admin if not in iframe
 */
function ensureEmbedded(req, res, next) {
  // Skip for API calls, webhooks, auth, and static assets
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth') ||
      req.path.startsWith('/webhooks') || req.path.startsWith('/billing')) {
    return next();
  }

  // If we have the shop param but not in embedded context, redirect to Shopify admin
  const shop = req.query.shop || req.cookies?.shopDomain;
  if (shop && !req.query.embedded && !req.headers['x-shopify-app-bridge']) {
    const apiKey = getApiKey();
    const host = req.query.host;
    if (host) {
      return res.redirect(`https://${shop}/admin/apps/${apiKey}`);
    }
  }

  next();
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
    nonce,
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
  verifySessionToken,
  verifyShopifySession,
  ensureEmbedded,
  buildAuthUrl,
  exchangeToken,
  getApiKey,
  getApiSecret,
  getHost,
  getScopes,
};
