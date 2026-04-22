require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const logger = require('./src/utils/logger');

const { verifyShopifySession, ensureEmbedded, getApiKey } = require('./src/middleware/auth');
const { verifyApiKey } = require('./src/middleware/apiAuth');
const dashboardRoutes = require('./src/routes/dashboard');
const jobRoutes = require('./src/routes/jobs');
const settingsRoutes = require('./src/routes/settings');
const apiRoutes = require('./src/routes/api');
const authRoutes = require('./src/routes/auth');
const webhookRoutes = require('./src/routes/webhooks');
const billingRoutes = require('./src/routes/billing');
const { startWorker, shutdown } = require('./src/services/jobQueue');

const app = express();
const PORT = process.env.PORT || process.env.BACKEND_PORT || 3000;

// Trust proxy (Railway, Cloudflare)
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Webhooks need raw body - must be before express.json()
app.use('/webhooks', express.raw({ type: 'application/json' }));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(cors());
app.use(fileUpload({
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  useTempFiles: true,
  tempFileDir: path.join(__dirname, 'uploads', 'tmp'),
  createParentPath: true,
}));
app.use(express.static(path.join(__dirname, 'public')));

// Make API key available to all templates (needed for App Bridge meta tag)
app.use((req, res, next) => {
  res.locals.apiKey = getApiKey();
  next();
});

// Override res.redirect to always include ?shop= for embedded iframe support
app.use((req, res, next) => {
  const origRedirect = res.redirect.bind(res);
  res.redirect = function(statusOrUrl, url) {
    let status, target;
    if (typeof statusOrUrl === 'number') {
      status = statusOrUrl;
      target = url;
    } else {
      status = 302;
      target = statusOrUrl;
    }
    // Append ?shop= if it's a local redirect and shop is known
    const shopDomain = req.shopDomain || req.query.shop || req.body?.shop || req.cookies?.shopDomain;
    if (shopDomain && target && !target.startsWith('http')) {
      try {
        const u = new URL(target, 'http://localhost');
        if (!u.searchParams.has('shop')) {
          u.searchParams.set('shop', shopDomain);
          target = u.pathname + u.search + u.hash;
        }
      } catch(e) {}
    }
    return origRedirect(status, target);
  };
  next();
});

// Content Security Policy for embedded app â MUST be before routes
app.use((req, res, next) => {
  const shopDomain = req.query.shop || req.cookies?.shopDomain;
  if (shopDomain) {
    res.setHeader(
      'Content-Security-Policy',
      `frame-ancestors https://${shopDomain} https://admin.shopify.com;`
    );
  } else {
    // Allow Shopify admin to frame the app during initial load
    res.setHeader(
      'Content-Security-Policy',
      `frame-ancestors https://admin.shopify.com https://*.myshopify.com;`
    );
  }
  next();
});

// Health check (for Railway/load balancer)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', uptime: process.uptime() });
});

// Auth routes (no session required)
app.use('/auth', authRoutes);

// Webhook routes (no session required, uses HMAC verification)
app.use('/webhooks', webhookRoutes);

// Admin: direct plan override (API key auth, bypasses Shopify billing)
app.get('/admin/set-plan', async (req, res) => {
  const { key, shop, plan } = req.query;
  if (!key || key !== process.env.ULTRA_MATRIX_API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  const { PLANS } = require('./src/services/billing');
  if (!plan || !PLANS[plan]) {
    return res.status(400).json({ error: 'Invalid plan', validPlans: Object.keys(PLANS) });
  }
  const { Shop: ShopModel } = require('./src/services/database');
  const shopDomain = shop || 'ultra-matrix-demo.myshopify.com';
  const shopRecord = await ShopModel.findUnique(shopDomain);
  if (!shopRecord) {
    return res.status(404).json({ error: 'Shop not found', shopDomain });
  }
  await ShopModel.update(shopRecord.id, { plan, chargeId: null, planExpiresAt: null });
  res.json({ success: true, shop: shopDomain, plan, message: `Plan set to ${plan}` });
});

// Agent API routes (API key auth)
app.use('/api/v1', verifyApiKey, apiRoutes);

// Billing routes (Shopify session auth)
app.use('/billing', verifyShopifySession, billingRoutes);

// App routes (Shopify session auth)
app.use('/', verifyShopifySession, dashboardRoutes);
app.use('/jobs', verifyShopifySession, jobRoutes);
app.use('/settings', verifyShopifySession, settingsRoutes);

// (CSP middleware moved above routes)

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      code: err.code || 'INTERNAL_ERROR',
    });
  }
  res.status(err.status || 500).render('error', {
    message: err.message || 'Something went wrong',
    error: process.env.NODE_ENV === 'development' ? err : {},
  });
});

// Start server and job queue worker
const server = app.listen(PORT, () => {
  const host = process.env.HOST || `http://localhost:${PORT}`;
  logger.info(`
ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
â              Ultra Matrix v2.0 - Shopify SaaS App        â
ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
â  Server:    http://localhost:${PORT}                         â
â  Public:    ${host.padEnd(44)}â
â  API:       ${(host + '/api/v1').padEnd(44)}â
â  Database:  PostgreSQL (Prisma)                          â
â  Queue:     BullMQ + Redis                               â
ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  `);
});

// Start the job queue worker
try {
  startWorker();
  logger.info('Job queue worker started');
} catch (err) {
  logger.error('Failed to start job queue worker:', err.message);
  logger.warn('Jobs will not process until Redis is available');
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await shutdown();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await shutdown();
  server.close(() => {
    process.exit(0);
  });
});

module.exports = app;
