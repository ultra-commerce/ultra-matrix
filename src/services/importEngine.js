/**
 * Import Job Engine
 * Processes CSV imports asynchronously, tracks progress, handles errors
 */

const { Job } = require('./database');
const ShopifyAPI = require('./shopifyApi');
const { parseCSV, parseCSVString, generateResultsCSV } = require('./csvParser');
const fs = require('fs');
const path = require('path');

// In-memory job queue (replace with Redis/Bull for production SaaS)
const activeJobs = new Map();

/**
 * Create and start an import job
 */
async function createImportJob({ shopId, shopDomain, accessToken, filePath, fileName, resourceType, triggeredBy = 'manual', csvString = null }) {
  const job = await Job.create({
    shopId,
    type: 'import',
    resourceType,
    status: 'pending',
    fileName: fileName || 'upload.csv',
    filePath: filePath || null,
    triggeredBy,
  });

  // Start processing async
  processJob(job.id, shopDomain, accessToken, filePath, resourceType, csvString).catch(err => {
    console.error(`Job ${job.id} failed:`, err);
  });

  return job;
}

/**
 * Process a job (runs async)
 */
async function processJob(jobId, shopDomain, accessToken, filePath, resourceType, csvString = null) {
  const shopify = new ShopifyAPI(shopDomain, accessToken);

  try {
    await Job.update(jobId, { status: 'processing', startedAt: new Date().toISOString() });
    activeJobs.set(jobId, { status: 'processing', cancel: false });

    // Parse CSV
    let parseResult;
    if (csvString) {
      parseResult = await parseCSVString(csvString, resourceType);
    } else if (filePath) {
      parseResult = await parseCSV(filePath, resourceType);
    } else {
      throw new Error('No CSV data provided');
    }

    const records = parseResult.records;
    const errors = parseResult.errors.map(e => `Line ${e.line}: ${e.error}`);

    await Job.update(jobId, { totalItems: records.length });

    if (records.length === 0) {
      await Job.update(jobId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        duration: 0,
        errors: JSON.stringify(errors.length > 0 ? errors : ['No valid records found in CSV']),
      });
      return;
    }

    // Process based on resource type
    let result;
    switch (resourceType) {
      case 'blog_posts':
        result = await processBlogPosts(jobId, shopify, records);
        break;
      case 'pages':
        result = await processPages(jobId, shopify, records);
        break;
      default:
        throw new Error(`Unsupported resource type: ${resourceType}`);
    }

    // Calculate duration
    const job = await Job.findById(jobId);
    const duration = job.startedAt ? Math.round((new Date() - new Date(job.startedAt)) / 1000) : 0;

    // Generate results file
    let resultFilePath = null;
    try {
      const resultsCSV = await generateResultsCSV(result.processedRecords);
      const resultsDir = path.join(__dirname, '..', '..', 'uploads', 'results');
      if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
      resultFilePath = path.join(resultsDir, `Import_Result_${new Date().toISOString().slice(0, 10)}_${jobId.slice(0, 8)}.csv`);
      fs.writeFileSync(resultFilePath, resultsCSV);
    } catch (e) {
      console.error('Failed to generate results CSV:', e);
    }

    const allErrors = [...errors, ...result.errors];
    const isCancelled = activeJobs.get(jobId)?.cancel;

    await Job.update(jobId, {
      status: isCancelled ? 'cancelled' : (result.failedItems > 0 && result.newItems === 0 && result.updatedItems === 0) ? 'failed' : 'completed',
      completedAt: new Date().toISOString(),
      duration,
      processedItems: result.processedItems,
      newItems: result.newItems,
      updatedItems: result.updatedItems,
      failedItems: result.failedItems,
      skippedItems: result.skippedItems,
      errors: allErrors.length > 0 ? JSON.stringify(allErrors.slice(0, 100)) : null,
      resultFilePath,
    });

  } catch (err) {
    console.error(`Job ${jobId} processing error:`, err);
    await Job.update(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      errors: JSON.stringify([err.message]),
    });
  } finally {
    activeJobs.delete(jobId);
  }
}

/**
 * Process blog post records
 */
async function processBlogPosts(jobId, shopify, records) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };
  const blogCache = new Map();

  for (const record of records) {
    if (activeJobs.get(jobId)?.cancel) break;

    try {
      const blogHandle = record.blog_handle || record.blog_title?.toLowerCase().replace(/\s+/g, '-') || 'news';
      let blog = blogCache.get(blogHandle);

      if (!blog) {
        blog = await shopify.getBlogByHandle(blogHandle);
        if (!blog) {
          const blogTitle = record.blog_title || blogHandle.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          blog = await shopify.createBlog(blogTitle, blogHandle);
        }
        blogCache.set(blogHandle, blog);
      }

      const command = (record.command || '').toLowerCase().trim();
      if (command === 'delete') {
        if (record.id) {
          await shopify.deleteArticle(blog.id, record.id);
          record._status = 'deleted';
          record._shopifyId = record.id;
          result.processedItems++;
          result.updatedItems++;
        } else {
          record._status = 'skipped';
          record._error = 'Cannot delete without ID';
          result.skippedItems++;
        }
        result.processedRecords.push(record);
        continue;
      }

      const articleData = {};
      if (record.title) articleData.title = record.title;
      if (record.body_html) articleData.body_html = record.body_html;
      if (record.author) articleData.author = record.author;
      if (record.summary_html) articleData.summary_html = record.summary_html;
      if (record.handle) articleData.handle = record.handle;
      if (record.template_suffix) articleData.template_suffix = record.template_suffix;
      if (record.tags) articleData.tags = record.tags;

      if (record.published !== undefined) {
        const pub = record.published.toLowerCase();
        articleData.published = pub === 'true' || pub === '1' || pub === 'yes';
      }
      if (record.published_at) articleData.published_at = record.published_at;
      if (record.image_src) {
        articleData.image = { src: record.image_src };
        if (record.image_alt) articleData.image.alt = record.image_alt;
      }

      const seoTitle = record.seo_title;
      const seoDescription = record.seo_description;

      let article = null;
      let isUpdate = false;

      if (record.id) {
        try {
          article = await shopify.updateArticle(blog.id, record.id, articleData);
          isUpdate = true;
        } catch (err) {
          if (err.status === 404) article = await shopify.createArticle(blog.id, articleData);
          else throw err;
        }
      } else if (record.handle) {
        const existing = await shopify.getArticleByHandle(blog.id, record.handle);
        if (existing) {
          article = await shopify.updateArticle(blog.id, existing.id, articleData);
          isUpdate = true;
        } else {
          article = await shopify.createArticle(blog.id, articleData);
        }
      } else {
        article = await shopify.createArticle(blog.id, articleData);
      }

      if (article && (seoTitle || seoDescription)) {
        const metafields = {};
        if (seoTitle) metafields['global.title_tag'] = { value: seoTitle, type: 'single_line_text_field' };
        if (seoDescription) metafields['global.description_tag'] = { value: seoDescription, type: 'single_line_text_field' };
        await shopify.setArticleMetafields(article.id, metafields);
      }

      if (article && record._metafields && Object.keys(record._metafields).length > 0) {
        await shopify.setArticleMetafields(article.id, record._metafields);
      }

      record._status = isUpdate ? 'updated' : 'new';
      record._shopifyId = article?.id || '';
      result.processedItems++;
      if (isUpdate) result.updatedItems++;
      else result.newItems++;

    } catch (err) {
      console.error(`Failed to process blog post "${record.title || record.handle || 'unknown'}":`, err.message);
      record._status = 'failed';
      record._error = err.message;
      result.failedItems++;
      result.errors.push(`Row ${record._line}: ${err.message}`);
    }

    result.processedRecords.push(record);

    if (result.processedItems % 5 === 0 || result.processedItems + result.failedItems === records.length) {
      await Job.update(jobId, {
        processedItems: result.processedItems + result.failedItems + result.skippedItems,
        newItems: result.newItems,
        updatedItems: result.updatedItems,
        failedItems: result.failedItems,
      });
    }

    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

/**
 * Process page records
 */
async function processPages(jobId, shopify, records) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };

  for (const record of records) {
    if (activeJobs.get(jobId)?.cancel) break;

    try {
      const command = (record.command || '').toLowerCase().trim();
      if (command === 'delete') {
        if (record.id) {
          await shopify.deletePage(record.id);
          record._status = 'deleted';
          record._shopifyId = record.id;
          result.processedItems++;
          result.updatedItems++;
        } else {
          record._status = 'skipped';
          record._error = 'Cannot delete without ID';
          result.skippedItems++;
        }
        result.processedRecords.push(record);
        continue;
      }

      const pageData = {};
      if (record.title) pageData.title = record.title;
      if (record.body_html) pageData.body_html = record.body_html;
      if (record.handle) pageData.handle = record.handle;
      if (record.author) pageData.author = record.author;
      if (record.template_suffix) pageData.template_suffix = record.template_suffix;

      if (record.published !== undefined) {
        const pub = record.published.toLowerCase();
        pageData.published = pub === 'true' || pub === '1' || pub === 'yes';
      }

      let page = null;
      let isUpdate = false;

      if (record.id) {
        try {
          page = await shopify.updatePage(record.id, pageData);
          isUpdate = true;
        } catch (err) {
          if (err.status === 404) page = await shopify.createPage(pageData);
          else throw err;
        }
      } else if (record.handle) {
        const existing = await shopify.getPageByHandle(record.handle);
        if (existing) {
          page = await shopify.updatePage(existing.id, pageData);
          isUpdate = true;
        } else {
          page = await shopify.createPage(pageData);
        }
      } else {
        page = await shopify.createPage(pageData);
      }

      if (page && (record.seo_title || record.seo_description)) {
        const metafields = {};
        if (record.seo_title) metafields['global.title_tag'] = { value: record.seo_title, type: 'single_line_text_field' };
        if (record.seo_description) metafields['global.description_tag'] = { value: record.seo_description, type: 'single_line_text_field' };
        for (const [fullKey, meta] of Object.entries(metafields)) {
          const parts = fullKey.split('.');
          try {
            await shopify.setMetafield(page.id, 'page', parts[0], parts.slice(1).join('.'), meta.value, meta.type);
          } catch (e) {
            console.error(`Metafield error for page ${page.id}:`, e.message);
          }
        }
      }

      record._status = isUpdate ? 'updated' : 'new';
      record._shopifyId = page?.id || '';
      result.processedItems++;
      if (isUpdate) result.updatedItems++;
      else result.newItems++;

    } catch (err) {
      record._status = 'failed';
      record._error = err.message;
      result.failedItems++;
      result.errors.push(`Row ${record._line}: ${err.message}`);
    }

    result.processedRecords.push(record);

    if (result.processedItems % 5 === 0) {
      await Job.update(jobId, {
        processedItems: result.processedItems + result.failedItems + result.skippedItems,
        newItems: result.newItems,
        updatedItems: result.updatedItems,
        failedItems: result.failedItems,
      });
    }

    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) { job.cancel = true; return true; }
  return false;
}

async function getJobStatus(jobId) {
  const job = await Job.findById(jobId);
  if (!job) return null;
  return {
    ...job,
    isActive: activeJobs.has(jobId),
    errors: job.errors ? JSON.parse(job.errors) : [],
  };
}

module.exports = { createImportJob, cancelJob, getJobStatus, activeJobs };
