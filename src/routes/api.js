/**
 * REST API v1 - Agent-focused endpoints
 * Used by Claude Cowork, OpenClaw, or any external agent/tool
 *
 * All endpoints require API key auth (handled by apiAuth middleware)
 * Base path: /api/v1
 */

const express = require('express');
const router = express.Router();
const { Job } = require('../services/database');
const { createImportJob, cancelJob, getJobStatus } = require('../services/importEngine');
const ShopifyAPI = require('../services/shopifyApi');

// ─── INFO ──────────────────────────────────────────────

router.get('/info', (req, res) => {
  res.json({
    app: 'Ultra Matrix',
    version: '1.0.0',
    shop: req.shopDomain,
    capabilities: ['import_blog_posts', 'import_pages', 'export_blog_posts', 'export_pages', 'manage_jobs'],
    csv_format: 'matrixify_compatible',
    supported_resources: ['blog_posts', 'pages'],
    api_docs: '/api/v1/docs',
  });
});

router.get('/docs', (req, res) => {
  res.json({
    endpoints: {
      'GET /api/v1/info': 'App info and capabilities',
      'GET /api/v1/docs': 'This documentation',
      'POST /api/v1/import': 'Start a CSV import job (multipart file upload or JSON body with csv_data)',
      'GET /api/v1/jobs': 'List all jobs',
      'GET /api/v1/jobs/:id': 'Get job status',
      'POST /api/v1/jobs/:id/cancel': 'Cancel a running job',
      'GET /api/v1/blogs': 'List all blogs',
      'GET /api/v1/blogs/:blogId/articles': 'List articles in a blog',
      'POST /api/v1/blogs/:blogId/articles': 'Create a single article',
      'PUT /api/v1/blogs/:blogId/articles/:id': 'Update a single article',
      'DELETE /api/v1/blogs/:blogId/articles/:id': 'Delete a single article',
      'GET /api/v1/pages': 'List all pages',
      'POST /api/v1/pages': 'Create a single page',
      'PUT /api/v1/pages/:id': 'Update a single page',
      'DELETE /api/v1/pages/:id': 'Delete a single page',
    },
    authentication: {
      methods: ['Authorization: Bearer <api_key>', 'X-API-Key: <api_key>', '?api_key=<api_key>'],
    },
    csv_format: {
      blog_posts: {
        required: ['Title'],
        optional: ['Handle', 'Body HTML', 'Author', 'Tags', 'Published', 'Published At', 'Blog: Handle', 'Blog: Title', 'Summary HTML', 'Template Suffix', 'Image: Src', 'Image: Alt', 'Metafield: title_tag [string]', 'Metafield: description_tag [string]'],
      },
      pages: {
        required: ['Title'],
        optional: ['Handle', 'Body HTML', 'Author', 'Published', 'Published At', 'Template Suffix', 'Metafield: title_tag [string]', 'Metafield: description_tag [string]'],
      },
    },
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

    // Option 1: File upload (multipart)
    if (req.files?.file) {
      const file = req.files.file;
      fileName = file.name;
      const fs = require('fs');
      const path = require('path');
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads', shop.id);
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      filePath = path.join(uploadsDir, `${Date.now()}_${file.name}`);
      await file.mv(filePath);
    }
    // Option 2: CSV data in request body
    else if (req.body?.csv_data) {
      csvString = req.body.csv_data;
      fileName = req.body.file_name || 'api_upload.csv';
    }
    // Option 3: JSON array of records (simplified format for agents)
    else if (req.body?.records && Array.isArray(req.body.records)) {
      const records = req.body.records;
      if (records.length === 0) {
        return res.status(400).json({ error: 'Empty records array' });
      }
      const headers = Object.keys(records[0]);
      const rows = records.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
      csvString = [headers.join(','), ...rows].join('\n');
      fileName = `agent_upload_${Date.now()}.csv`;
    }
    else {
      return res.status(400).json({
        error: 'No data provided',
        hint: 'Send CSV via file upload (multipart), csv_data field (string), or records array (JSON)',
        example: {
          records: [
            { 'Title': 'My Post', 'Body HTML': '<p>Content</p>', 'Blog: Handle': 'news', 'Tags': 'example' }
          ],
          resource_type: 'blog_posts'
        }
      });
    }

    const job = await createImportJob({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      accessToken: shop.accessToken,
      filePath,
      fileName,
      resourceType,
      triggeredBy: 'api',
      csvString,
    });

    res.status(202).json({
      success: true,
      job: { id: job.id, status: job.status, resourceType: job.resourceType, fileName },
      status_url: `/api/v1/jobs/${job.id}`,
    });
  } catch (error) {
    console.error('API import error:', error);
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
      total,
      limit,
      offset,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const status = await getJobStatus(req.params.id);
    if (!status || status.shopId !== req.shop.id) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/jobs/:id/cancel', async (req, res) => {
  try {
    const success = cancelJob(req.params.id);
    res.json({ success, message: success ? 'Job cancellation requested' : 'Job not found or not running' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DIRECT SHOPIFY OPERATIONS ─────────────────────────

router.get('/blogs', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    const blogs = await shopify.getBlogs();
    res.json({ blogs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/blogs/:blogId/articles', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    const articles = await shopify.getArticles(req.params.blogId, { limit: req.query.limit || 50 });
    res.json({ articles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/blogs/:blogId/articles', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    const article = await shopify.createArticle(req.params.blogId, req.body);
    res.status(201).json({ article });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/blogs/:blogId/articles/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    const article = await shopify.updateArticle(req.params.blogId, req.params.id, req.body);
    res.json({ article });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/blogs/:blogId/articles/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    await shopify.deleteArticle(req.params.blogId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/pages', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    const pages = await shopify.getPages({ limit: req.query.limit || 50 });
    res.json({ pages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/pages', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    const page = await shopify.createPage(req.body);
    res.status(201).json({ page });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/pages/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    const page = await shopify.updatePage(req.params.id, req.body);
    res.json({ page });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/pages/:id', async (req, res) => {
  try {
    const shopify = new ShopifyAPI(req.shopDomain, req.accessToken);
    await shopify.deletePage(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
