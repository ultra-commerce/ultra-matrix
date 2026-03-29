require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const fileUpload = require('express-fileupload');

const { verifyShopifySession } = require('./src/middleware/auth');
const { verifyApiKey } = require('./src/middleware/apiAuth');
const dashboardRoutes = require('./src/routes/dashboard');
const jobRoutes = require('./src/routes/jobs');
const settingsRoutes = require('./src/routes/settings');
const apiRoutes = require('./src/routes/api');
const authRoutes = require('./src/routes/auth');
const webhookRoutes = require('./src/routes/webhooks');

const app = express();

// Shopify CLI sets PORT for frontend role, BACKEND_PORT for backend role
const PORT = process.env.PORT || process.env.BACKEND_PORT || 3000;

// Shopify CLI also sets these automatically:
// SHOPIFY_API_KEY (same as client_id from dev dashboard)
// SHOPIFY_API_SECRET (same as secret from dev dashboard)
// SCOPES
// HOST (the Cloudflare tunnel URL)

// Trust proxy (for Cloudflare tunnel)
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

// Auth routes (no session required)
app.use('/auth', authRoutes);

// Webhook routes
app.use('/webhooks', webhookRoutes);

// Agent API routes (API key auth)
app.use('/api/v1', verifyApiKey, apiRoutes);

// Dashboard routes (Shopify session auth)
app.use('/', verifyShopifySession, dashboardRoutes);
app.use('/jobs', verifyShopifySession, jobRoutes);
app.use('/settings', verifyShopifySession, settingsRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      code: err.code || 'INTERNAL_ERROR'
    });
  }
  res.status(err.status || 500).render('error', {
    message: err.message || 'Something went wrong',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

app.listen(PORT, () => {
  const host = process.env.HOST || `http://localhost:${PORT}`;
  console.log(`
╔══════════════════════════════════════════════════════╗
║              Ultra Matrix - Shopify App              ║
║──────────────────────────────────────────────────────║
║  Server running on port ${PORT}                         ║
║  Local:     http://localhost:${PORT}                    ║
║  Public:    ${host.padEnd(40)}║
║  API:       ${(host + '/api/v1').padEnd(40)}║
╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
