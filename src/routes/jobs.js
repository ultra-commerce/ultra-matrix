const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { Job } = require('../services/database');
const { createImportJob, cancelJob, getJobStatus } = require('../services/importEngine');

// GET /jobs - All Jobs page
router.get('/', async (req, res) => {
  try {
    const shop = req.shop;
    const page = parseInt(req.query.page) || 1;
    const perPage = 20;
    const filter = req.query.filter || '';
    const statusFilter = req.query.status || '';

    const totalJobs = await Job.count({ shopId: shop.id, status: statusFilter || undefined, filter: filter || undefined });
    const totalPages = Math.ceil(totalJobs / perPage);

    const jobs = await Job.findMany({
      shopId: shop.id,
      status: statusFilter || undefined,
      filter: filter || undefined,
      skip: (page - 1) * perPage,
      take: perPage,
    });

    res.render('jobs', {
      page: 'jobs',
      shop,
      jobs,
      pagination: { current: page, total: totalPages, perPage },
      filter,
      statusFilter,
      shopDomain: shop.shopDomain,
    });
  } catch (error) {
    console.error('Jobs page error:', error);
    res.status(500).render('error', { message: error.message });
  }
});

// POST /jobs/import - Upload CSV and start import
router.post('/import', async (req, res) => {
  try {
    const shop = req.shop;

    if (!req.files || !req.files.csvFile) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    const csvFile = req.files.csvFile;
    const resourceType = req.body.resourceType || 'blog_posts';

    const uploadsDir = path.join(__dirname, '..', '..', 'uploads', shop.id);
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filePath = path.join(uploadsDir, `${Date.now()}_${csvFile.name}`);
    await csvFile.mv(filePath);

    const job = await createImportJob({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      accessToken: shop.accessToken,
      filePath,
      fileName: csvFile.name,
      resourceType,
      triggeredBy: 'manual',
    });

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, jobId: job.id });
    }
    res.redirect('/jobs');
  } catch (error) {
    console.error('Import error:', error);
    if (req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: error.message });
    }
    res.status(500).render('error', { message: error.message });
  }
});

// GET /jobs/:id - Single job detail
router.get('/:id', async (req, res) => {
  try {
    const jobStatus = await getJobStatus(req.params.id);
    if (!jobStatus || jobStatus.shopId !== req.shop.id) {
      return res.status(404).render('error', { message: 'Job not found' });
    }

    if (req.headers.accept?.includes('application/json')) {
      return res.json(jobStatus);
    }

    res.render('jobDetail', {
      page: 'jobs',
      shop: req.shop,
      job: jobStatus,
      shopDomain: req.shop.shopDomain,
    });
  } catch (error) {
    res.status(500).render('error', { message: error.message });
  }
});

// POST /jobs/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  try {
    const success = cancelJob(req.params.id);
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ success });
    }
    res.redirect('/jobs');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /jobs/:id/results - Download results file
router.get('/:id/results', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job || job.shopId !== req.shop.id || !job.resultFilePath) {
      return res.status(404).send('Results not found');
    }

    if (fs.existsSync(job.resultFilePath)) {
      res.download(job.resultFilePath);
    } else {
      res.status(404).send('Results file not found');
    }
  } catch (error) {
    res.status(500).send(error.message);
  }
});

module.exports = router;
