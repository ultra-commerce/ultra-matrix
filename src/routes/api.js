/**
 * REST API v1 - Agent-focused endpoints
 * All endpoints require API key auth (handled by apiAuth middleware)
 * Base path: /api/v1
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { Job } = require('../services/database');
const { enqueueJob, cancelJob, getQueueStats } = require('../services/jobQueue');
const { checkPlanLimit, PLANS, getPlan } = require('../services/billing');
const ShopifyAPI = require('../services/shopifyApi');

const SUPPORTED_RESOURCES = [
  'blog_posts', 'pages', 'products', 'customers', 'orders',
  'redirects', 'custom_collections', 'smart_collections',
];

// ─── INFO ──────────────────────────────────────────────

router.get('/info', async (req, res) => {
  const stats = await getQueueStats().catch(() => ({}));
  res.json({
    app: 'Ultra Matrix',
    version: '2.0.0',
    shop: req.shopDomain,
    plan: req.shop.plan || 'free',
    capabilities: ['import', 'export', 'manage_jobs'],
    csv_format: 'matrixify_compatible',
    supported_resources: SUPPORTED_RESOURCES,
    queue: stats,
    api_docs: '/api/v1/docs',
  });
});

router.get('/docs', (req, res) => {
  res.json({
    version: '2.0.0',
    endpoints: {
      'GET /api/v1/info': 'App info, capabilities, and queue stats',
      'GET /api/v1/docs': 'This documentation',
      'POST /api/v1/import': 'Start a CSV import job (multipart file or JSON body)',
      'POST /api/v1/export': 'Start a CSV export job',
      'GET /api/v1/jobs': 'List all jobs (paginated)',
      'GET /api/v1/jobs/:id': 'Get job status and details',
      'POST /api/v1/jobs/:id/cancel': 'Cancel a running job',
      'GET /api/v1/queue': 'Get queue statistics',
      'GET /api/v1/plan': 'Get current plan and limits',
      'GET /api/v1/blogs': 'List all blogs',
      'GET /api/v1/blogs/:blogId/articles': 'List articles in a blog',
      'POST /api/v1/blogs/:blogId/articles': 'Create a single article',
      'PUT /api/v1/blogs/:blogId/articles/:id': 'Update a single article',
      'DELETE /api/v1/blogs/:blogId/articles/:id': 'Delete a single article',
      'GET /api/v1/pages': 'List all pages',
      'POST /api/v1/pages': 'Create a single page',
      'PUT /api/v1/pages/:id': 'Update a single page',
      'DELETE /api/v1/pages/:id': 'Delete a single page',
      'GET /api/v1/products': 'List products',
      'POST /api/v1/products': 'Create a product',
      'PUT /api/v1/products/:id': 'Update a product',
      'DELETE /api/v1/products/:id': 'Delete a product',
      'GET /api/v1/customers': 'List customers',
      'GET /api/v1/orders': 'List orders',
      'GET /api/v1/redirects': 'List redirects',
      'GET /api/v1/collections': 'List custom collections',
      'GET /api/v1/smart-collections': 'List smart collections',
    },
    authentication: {
      methods: ['Authorization: Bearer <api_key>', 'X-API-Key: <api_key>', '?api_key=<api_key>'],
    },
    supported_resources: SUPPORTED_RESOURCES,
  });
});

// ─── IMPORT ────────────────────────────────────────────

router.post('/import', async (req, res) => {
  try {
    const shop = req.shop;
    let filePath = null;
    let fileName = 'api_upload.csv';
    let csvString = null;
    const resourceType = req.body?.resource_type || req.query.resource_type || 'blog_posts';

    if (!SUPPORTED_RESOURCES.includes(resourceType)) {
      return res.status(400).json({
        error: `Unsupported resource type: ${resourceType}`,
        supported: SUPPORTED_RESOURCES,
      });
    }

    // Option 1: File upload
    if (req.files?.file) {
      const file = req.files.file;
      fileName = file.name;
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads', shop.id);
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      filePath = path.join(uploadsDir, `${Date.now()}_${file.name}`);
      await file.mv(filePath);
    }
    // Option 2: CSV string
    else if (req.body?.csv_data) {
      // Save to file for queue processing
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads', shop.id);
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fileName = req.body.file_name || 'api_upload.csv';
      filePath = path.join(uploadsDir, `${Date.now()}_${fileName}`);
      fs.writeFileSync(filePath, req.body.csv_data);
    }
    // Option 3: JSON records
    else if (req.body?.records && Array.isArray(req.body.records)) {
      const records = req.body.records;
      if (records.length === 0) return res.status(400).json({ error: 'Empty records array' });

      const headers = Object.keys(records[0]);
      const rows = records.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
      csvString = [headers.join(','), ...rows].join('\n');

      // Save to file
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads', shop.id);
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fileName = `agent_upload_${Date.now()}.csv`;
      filePath = path.join(uploadsDir, fileName);
      fs.writeFileSync(filePath, csvString);
    }
    else {
      return res.status(400).json({
        error: 'No data provided',
        hint: 'Send CSV via file upload (multipart), csv_data field (string), or records array (JSON)',
      });
    }

    // Create job and enqueue
    const jobRecord = await Job.create({
      shopId: shop.id,
      type: 'import',
      resourceType,
      status: 'pending',
      fileName,
      filePath,
      triggeredBy: 'api',
    });

    await enqueueJob(jobRecord);

    res.status(202).json({
      success: true,
      job: { id: jobRecord.id, status: 'queued', resourceType, fileName },
      status_url: `/api/v1/jobs/${jobRecord.id}`,
    });
  } catch (error) {
    console.error('API import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── EXPORT ───────────────────────────────────────────

router.post('/export', async (req, res) => {
  try {
    const shop = req.shop;
    const resourceType = req.body?.resource_type || req.query.resource_type || 'blog_posts';

    if (!SUPPORTED_RESOURCES.includes(resourceType)) {
      return res.status(400).json({
        error: `Unsupported resource type: ${resourceType}`,
        supported: SUPPORTED_RESOURCES,
      });
    }

    const jobRecord = await Job.create({
      shopId: shop.id,
      type: 'export',
      resourceType,
      status: 'pending',
      fileName: `Export_${resourceType}.csv`,
      triggeredBy: 'api',
    });

    await enqueueJob(jobRecord);

    res.status(202).json({
      success: true,
      job: { id: jobRecord.id, status: 'queued', resourceType },
      status_url: `/api/v1/jobs/${jobRecord.id}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── JOBS ──────────────────────────────────────────────

router.get('/jobs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status;

    const [jobs, total] = await Promise.all([
      Job.findMany({ shopId: req.shop.id, status: status || undefined, skip: offset, take: limit }),
      Job.count({ shopId: req.shop.id, status: status || undefined }),
    ]);

    res.json({
      jobs: jobs.map(j => ({
        ...j,
        errors: j.errors ? JSON.parse(j.errors) : [],
      })),
      total, limit, offset,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job || job.shopId !== req.shop.id) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ ...job, errors: job.errors ? JSON.parse(job.errors) : [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/jobs/:id/cancel', async (req, res) => {
  try {
    const success = cancelJob(req.params.id);
    if (success) {
      await Job.update(req.params.id, { status: 'cancelled' });
    }
    res.json({ success, message: success ? 'Job cancellation requested' : 'Job not found or not running' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── QUEUE STATS ──────────────────────────────────────

router.get('/queue', async (req, res) => {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── PLAN INFO ────────────────────────────────────────

router.get('/plan', (req, res) => {
  const plan = getPlan(req.shop.plan || 'free');
  res.json({
    current: req.shop.plan || 'free',
    name: plan.name,
    limits: plan.limits,
    features: plan.features,
    allPlans: Object.entries(PLANS).map(([key, p]) => ({
      id: key, name: p.name, price: p.price, limits: p.limits, features: p.features,
    })),
  });
});

// ─── DIRECT SHOPIFY OPERATIONS ─────────────────────────

// Blogs
router.get('/blogs', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ blogs: await shopify.getBlogs() });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/blogs/:blogId/articles', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ articles: await shopify.getArticles(req.params.blogId, { limit: req.query.limit || 50 }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/blogs/:blogId/articles', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.status(201).json({ article: await shopify.createArticle(req.params.blogId, req.body) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/blogs/:blogId/articles/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ article: await shopify.updateArticle(req.params.blogId, req.params.id, req.body) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/blogs/:blogId/articles/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    await shopify.deleteArticle(req.params.blogId, req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Pages
router.get('/pages', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ pages: await shopify.getPages({ limit: req.query.limit || 50 }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/pages', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.status(201).json({ page: await shopify.createPage(req.body) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/pages/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ page: await shopify.updatePage(req.params.id, req.body) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/pages/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    await shopify.deletePage(req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Products
router.get('/products', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ products: await shopify.getProducts({ limit: req.query.limit || 50 }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/products', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.status(201).json({ product: await shopify.createProduct(req.body) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/products/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ product: await shopify.updateProduct(req.params.id, req.body) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    await shopify.deleteProduct(req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Customers
router.get('/customers', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ customers: await shopify.getCustomers({ limit: req.query.limit || 50 }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Orders
router.get('/orders', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ orders: await shopify.getOrders({ limit: req.query.limit || 50, status: 'any' }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Redirects
router.get('/redirects', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ redirects: await shopify.getRedirects({ limit: req.query.limit || 50 }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Collections
router.get('/collections', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ collections: await shopify.getCustomCollections({ limit: req.query.limit || 50 }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/smart-collections', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    res.json({ smart_collections: await shopify.getSmartCollections({ limit: req.query.limit || 50 }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
