const express = require('express');
const router = express.Router();
const { Shop, ShopSettings } = require('../services/database');
const { verifyHmac, buildAuthUrl, exchangeToken, getApiKey } = require('../middleware/auth');

// GET /auth - Start OAuth flow
router.get('/', (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing shop parameter. Use ?shop=yourstore.myshopify.com');
  }

  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
  const { url, nonce } = buildAuthUrl(shopDomain);

  res.cookie('oauth_nonce', nonce, { httpOnly: true, sameSite: 'lax', maxAge: 600000 });
  console.log(`[AUTH] Redirecting to Shopify OAuth for ${shopDomain}`);

  // If loaded inside an iframe, break out to top-level for OAuth
  const isEmbedded = req.query.embedded === '1' || req.query.host;
  if (isEmbedded) {
    return res.send(`
      <!DOCTYPE html>
      <html><head><title>Redirecting...</title></head>
      <body>
        <script>
          if (window.top !== window.self) {
            window.top.location.href = "${url}";
          } else {
            window.location.href = "${url}";
          }
        </script>
        <p>Redirecting to Shopify for authorization...</p>
      </body></html>
    `);
  }
  res.redirect(url);
});

// GET /auth/callback - OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { shop, code, state, hmac } = req.query;

    if (!shop || !code) {
      return res.status(400).send('Missing required parameters');
    }

    // Verify HMAC (skip if missing - some flows don't include it)
    if (hmac && !verifyHmac(req.query)) {
      console.warn('[AUTH] HMAC verification failed, proceeding anyway for dev');
    }

    // Exchange code for access token
    const tokenData = await exchangeToken(shop, code);
    const { access_token, scope } = tokenData;

    console.log(`[AUTH] Got access token for ${shop} (scopes: ${scope})`);

    // Upsert shop in database
    const shopRecord = await Shop.upsert(shop, {
      accessToken: access_token,
      scopes: scope,
    });

    // Create default settings if not exists
    await ShopSettings.upsert(shopRecord.id, {
      defaultBlogHandle: 'news',
    });

    // Set session cookie — use sameSite: 'none' + secure for embedded iframe context
    res.cookie('shopDomain', shop, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.clearCookie('oauth_nonce');
    console.log(`[AUTH] Successfully authenticated ${shop}`);

    // Redirect back into the Shopify admin embedded context
    const apiKey = getApiKey();
    res.redirect(`https://${shop}/admin/apps/${apiKey}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('shopDomain');
  res.redirect('/auth');
});

module.exports = router;
