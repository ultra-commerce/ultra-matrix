/**
 * Import Engine
 * Processes CSV imports for all resource types.
 * Called by the job queue worker — NOT directly from routes.
 */

const { Job } = require('./database');
const ShopifyAPI = require('./shopifyApi');
const { parseCSV, parseCSVString, generateResultsCSV } = require('./csvParser');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Process an import job (called by the queue worker)
 */
async function processImportJob({ jobId, shopDomain, accessToken, filePath, resourceType, csvString, isCancelled }) {
  const shopify = new ShopifyAPI(shopDomain, accessToken);

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
      result = await processBlogPosts(jobId, shopify, records, isCancelled);
      break;
    case 'pages':
      result = await processPages(jobId, shopify, records, isCancelled);
      break;
    case 'products':
      result = await processProducts(jobId, shopify, records, isCancelled);
      break;
    case 'customers':
      result = await processCustomers(jobId, shopify, records, isCancelled);
      break;
    case 'orders':
      result = await processOrders(jobId, shopify, records, isCancelled);
      break;
    case 'redirects':
      result = await processRedirects(jobId, shopify, records, isCancelled);
      break;
    case 'collections':
    case 'custom_collections':
      result = await processCustomCollections(jobId, shopify, records, isCancelled);
      break;
    case 'smart_collections':
      result = await processSmartCollections(jobId, shopify, records, isCancelled);
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
    logger.error('Failed to generate results CSV:', e);
  }

  const allErrors = [...errors, ...result.errors];
  const wasCancelled = isCancelled && isCancelled();

  await Job.update(jobId, {
    status: wasCancelled ? 'cancelled' : (result.failedItems > 0 && result.newItems === 0 && result.updatedItems === 0) ? 'failed' : 'completed',
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
}

/**
 * Helper: update job progress in DB periodically
 */
async function updateProgress(jobId, result) {
  await Job.update(jobId, {
    processedItems: result.processedItems + result.failedItems + result.skippedItems,
    newItems: result.newItems,
    updatedItems: result.updatedItems,
    failedItems: result.failedItems,
    skippedItems: result.skippedItems,
  });
}

/**
 * Process blog post records
 */
async function processBlogPosts(jobId, shopify, records, isCancelled) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };
  const blogCache = new Map();

  for (const record of records) {
    if (isCancelled && isCancelled()) break;

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
      logger.error(`Failed to process blog post "${record.title || record.handle || 'unknown'}":`, err.message);
      record._status = 'failed';
      record._error = err.message;
      result.failedItems++;
      result.errors.push(`Row ${record._line}: ${err.message}`);
    }

    result.processedRecords.push(record);

    if (result.processedItems % 5 === 0 || result.processedItems + result.failedItems === records.length) {
      await updateProgress(jobId, result);
    }

    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

/**
 * Process page records
 */
async function processPages(jobId, shopify, records, isCancelled) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };

  for (const record of records) {
    if (isCancelled && isCancelled()) break;

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
            logger.error(`Metafield error for page ${page.id}:`, e.message);
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
      await updateProgress(jobId, result);
    }

    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

/**
 * Process product records
 */
async function processProducts(jobId, shopify, records, isCancelled) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };

  for (const record of records) {
    if (isCancelled && isCancelled()) break;

    try {
      const command = (record.command || '').toLowerCase().trim();

      if (command === 'delete') {
        if (record.id) {
          await shopify.deleteProduct(record.id);
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

      const productData = {};
      if (record.title) productData.title = record.title;
      if (record.body_html) productData.body_html = record.body_html;
      if (record.vendor) productData.vendor = record.vendor;
      if (record.product_type) productData.product_type = record.product_type;
      if (record.tags) productData.tags = record.tags;
      if (record.handle) productData.handle = record.handle;
      if (record.template_suffix) productData.template_suffix = record.template_suffix;
      if (record.status) productData.status = record.status; // active, draft, archived

      if (record.published !== undefined) {
        const pub = record.published.toLowerCase();
        productData.published = pub === 'true' || pub === '1' || pub === 'yes';
      }

      // Build variant data if present
      const variant = {};
      let hasVariant = false;
      if (record.variant_sku) { variant.sku = record.variant_sku; hasVariant = true; }
      if (record.variant_price) { variant.price = record.variant_price; hasVariant = true; }
      if (record.variant_compare_at_price) { variant.compare_at_price = record.variant_compare_at_price; hasVariant = true; }
      if (record.variant_grams) { variant.grams = parseInt(record.variant_grams); hasVariant = true; }
      if (record.variant_weight) { variant.weight = parseFloat(record.variant_weight); hasVariant = true; }
      if (record.variant_weight_unit) { variant.weight_unit = record.variant_weight_unit; hasVariant = true; }
      if (record.variant_inventory_qty) { variant.inventory_quantity = parseInt(record.variant_inventory_qty); hasVariant = true; }
      if (record.variant_barcode) { variant.barcode = record.variant_barcode; hasVariant = true; }
      if (record.variant_requires_shipping !== undefined) {
        variant.requires_shipping = record.variant_requires_shipping.toLowerCase() === 'true';
        hasVariant = true;
      }
      if (record.variant_taxable !== undefined) {
        variant.taxable = record.variant_taxable.toLowerCase() === 'true';
        hasVariant = true;
      }

      // Options
      if (record.option1_name) {
        productData.options = productData.options || [];
        productData.options[0] = { name: record.option1_name };
      }
      if (record.option1_value) { variant.option1 = record.option1_value; hasVariant = true; }
      if (record.option2_name) {
        productData.options = productData.options || [];
        productData.options[1] = { name: record.option2_name };
      }
      if (record.option2_value) { variant.option2 = record.option2_value; hasVariant = true; }
      if (record.option3_name) {
        productData.options = productData.options || [];
        productData.options[2] = { name: record.option3_name };
      }
      if (record.option3_value) { variant.option3 = record.option3_value; hasVariant = true; }

      // Images
      if (record.image_src) {
        productData.images = [{ src: record.image_src }];
        if (record.image_alt) productData.images[0].alt = record.image_alt;
      }

      if (hasVariant && !record.id) {
        productData.variants = [variant];
      }

      let product = null;
      let isUpdate = false;

      if (record.id) {
        try {
          product = await shopify.updateProduct(record.id, productData);
          isUpdate = true;

          // If there's variant data, update the first variant
          if (hasVariant && product.variants && product.variants.length > 0) {
            const variantId = record.variant_id || product.variants[0].id;
            await shopify.updateVariant(variantId, variant);
          }
        } catch (err) {
          if (err.status === 404) {
            product = await shopify.createProduct(productData);
          } else throw err;
        }
      } else if (record.handle) {
        const existing = await shopify.getProductByHandle(record.handle);
        if (existing) {
          product = await shopify.updateProduct(existing.id, productData);
          isUpdate = true;
          if (hasVariant && existing.variants && existing.variants.length > 0) {
            const variantId = record.variant_id || existing.variants[0].id;
            await shopify.updateVariant(variantId, variant);
          }
        } else {
          product = await shopify.createProduct(productData);
        }
      } else {
        product = await shopify.createProduct(productData);
      }

      // SEO metafields
      if (product && (record.seo_title || record.seo_description)) {
        if (record.seo_title) {
          await shopify.setMetafield(product.id, 'product', 'global', 'title_tag', record.seo_title, 'single_line_text_field').catch(() => {});
        }
        if (record.seo_description) {
          await shopify.setMetafield(product.id, 'product', 'global', 'description_tag', record.seo_description, 'single_line_text_field').catch(() => {});
        }
      }

      record._status = isUpdate ? 'updated' : 'new';
      record._shopifyId = product?.id || '';
      result.processedItems++;
      if (isUpdate) result.updatedItems++;
      else result.newItems++;

    } catch (err) {
      logger.error(`Failed to process product "${record.title || record.handle || 'unknown'}":`, err.message);
      record._status = 'failed';
      record._error = err.message;
      result.failedItems++;
      result.errors.push(`Row ${record._line}: ${err.message}`);
    }

    result.processedRecords.push(record);

    if (result.processedItems % 5 === 0 || result.processedItems + result.failedItems === records.length) {
      await updateProgress(jobId, result);
    }

    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

/**
 * Process customer records
 */
async function processCustomers(jobId, shopify, records, isCancelled) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };

  for (const record of records) {
    if (isCancelled && isCancelled()) break;

    try {
      const command = (record.command || '').toLowerCase().trim();

      if (command === 'delete') {
        if (record.id) {
          await shopify.deleteCustomer(record.id);
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

      const customerData = {};
      if (record.first_name) customerData.first_name = record.first_name;
      if (record.last_name) customerData.last_name = record.last_name;
      if (record.email) customerData.email = record.email;
      if (record.phone) customerData.phone = record.phone;
      if (record.tags) customerData.tags = record.tags;
      if (record.note) customerData.note = record.note;
      if (record.tax_exempt !== undefined) {
        customerData.tax_exempt = record.tax_exempt.toLowerCase() === 'true';
      }

      // Address
      if (record.address1 || record.city || record.province || record.country) {
        const address = {};
        if (record.address1) address.address1 = record.address1;
        if (record.address2) address.address2 = record.address2;
        if (record.city) address.city = record.city;
        if (record.province) address.province = record.province;
        if (record.province_code) address.province_code = record.province_code;
        if (record.country) address.country = record.country;
        if (record.country_code) address.country_code = record.country_code;
        if (record.zip) address.zip = record.zip;
        if (record.phone) address.phone = record.phone;
        if (record.company) address.company = record.company;
        customerData.addresses = [address];
      }

      let customer = null;
      let isUpdate = false;

      if (record.id) {
        try {
          customer = await shopify.updateCustomer(record.id, customerData);
          isUpdate = true;
        } catch (err) {
          if (err.status === 404) customer = await shopify.createCustomer(customerData);
          else throw err;
        }
      } else if (record.email) {
        const existing = await shopify.searchCustomersByEmail(record.email);
        if (existing && existing.length > 0) {
          customer = await shopify.updateCustomer(existing[0].id, customerData);
          isUpdate = true;
        } else {
          customer = await shopify.createCustomer(customerData);
        }
      } else {
        customer = await shopify.createCustomer(customerData);
      }

      record._status = isUpdate ? 'updated' : 'new';
      record._shopifyId = customer?.id || '';
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
    if (result.processedItems % 5 === 0) await updateProgress(jobId, result);
    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

/**
 * Process redirect records
 */
async function processRedirects(jobId, shopify, records, isCancelled) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };

  for (const record of records) {
    if (isCancelled && isCancelled()) break;

    try {
      const command = (record.command || '').toLowerCase().trim();

      if (command === 'delete') {
        if (record.id) {
          await shopify.deleteRedirect(record.id);
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

      if (!record.path || !record.target) {
        record._status = 'skipped';
        record._error = 'Redirect requires both path and target';
        result.skippedItems++;
        result.processedRecords.push(record);
        continue;
      }

      const redirectData = {
        path: record.path,
        target: record.target,
      };

      let redirect = null;
      let isUpdate = false;

      if (record.id) {
        try {
          redirect = await shopify.updateRedirect(record.id, redirectData);
          isUpdate = true;
        } catch (err) {
          if (err.status === 404) redirect = await shopify.createRedirect(redirectData);
          else throw err;
        }
      } else {
        redirect = await shopify.createRedirect(redirectData);
      }

      record._status = isUpdate ? 'updated' : 'new';
      record._shopifyId = redirect?.id || '';
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
    if (result.processedItems % 10 === 0) await updateProgress(jobId, result);
    await new Promise(r => setTimeout(r, 100)); // Redirects are lighter, faster interval
  }

  return result;
}

/**
 * Process custom collection records
 */
async function processCustomCollections(jobId, shopify, records, isCancelled) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };

  for (const record of records) {
    if (isCancelled && isCancelled()) break;

    try {
      const command = (record.command || '').toLowerCase().trim();

      if (command === 'delete') {
        if (record.id) {
          await shopify.deleteCustomCollection(record.id);
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

      const collectionData = {};
      if (record.title) collectionData.title = record.title;
      if (record.body_html) collectionData.body_html = record.body_html;
      if (record.handle) collectionData.handle = record.handle;
      if (record.template_suffix) collectionData.template_suffix = record.template_suffix;
      if (record.sort_order) collectionData.sort_order = record.sort_order;
      if (record.published !== undefined) {
        collectionData.published = record.published.toLowerCase() === 'true';
      }
      if (record.image_src) {
        collectionData.image = { src: record.image_src };
        if (record.image_alt) collectionData.image.alt = record.image_alt;
      }

      let collection = null;
      let isUpdate = false;

      if (record.id) {
        try {
          collection = await shopify.updateCustomCollection(record.id, collectionData);
          isUpdate = true;
        } catch (err) {
          if (err.status === 404) collection = await shopify.createCustomCollection(collectionData);
          else throw err;
        }
      } else if (record.handle) {
        const existing = await shopify.getCustomCollectionByHandle(record.handle);
        if (existing) {
          collection = await shopify.updateCustomCollection(existing.id, collectionData);
          isUpdate = true;
        } else {
          collection = await shopify.createCustomCollection(collectionData);
        }
      } else {
        collection = await shopify.createCustomCollection(collectionData);
      }

      record._status = isUpdate ? 'updated' : 'new';
      record._shopifyId = collection?.id || '';
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
    if (result.processedItems % 5 === 0) await updateProgress(jobId, result);
    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

/**
 * Process smart collection records
 */
async function processSmartCollections(jobId, shopify, records, isCancelled) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };

  for (const record of records) {
    if (isCancelled && isCancelled()) break;

    try {
      const command = (record.command || '').toLowerCase().trim();

      if (command === 'delete') {
        if (record.id) {
          await shopify.deleteSmartCollection(record.id);
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

      const collectionData = {};
      if (record.title) collectionData.title = record.title;
      if (record.body_html) collectionData.body_html = record.body_html;
      if (record.handle) collectionData.handle = record.handle;
      if (record.template_suffix) collectionData.template_suffix = record.template_suffix;
      if (record.sort_order) collectionData.sort_order = record.sort_order;
      if (record.published !== undefined) {
        collectionData.published = record.published.toLowerCase() === 'true';
      }

      // Parse rules if present (JSON string or structured)
      if (record.rules) {
        try {
          collectionData.rules = typeof record.rules === 'string' ? JSON.parse(record.rules) : record.rules;
        } catch (e) {
          logger.warn(`Could not parse rules for smart collection: ${e.message}`);
        }
      }

      if (record.disjunctive !== undefined) {
        collectionData.disjunctive = record.disjunctive.toLowerCase() === 'true';
      }

      let collection = null;
      let isUpdate = false;

      if (record.id) {
        try {
          collection = await shopify.updateSmartCollection(record.id, collectionData);
          isUpdate = true;
        } catch (err) {
          if (err.status === 404) collection = await shopify.createSmartCollection(collectionData);
          else throw err;
        }
      } else if (record.handle) {
        const existing = await shopify.getSmartCollectionByHandle(record.handle);
        if (existing) {
          collection = await shopify.updateSmartCollection(existing.id, collectionData);
          isUpdate = true;
        } else {
          collection = await shopify.createSmartCollection(collectionData);
        }
      } else {
        collection = await shopify.createSmartCollection(collectionData);
      }

      record._status = isUpdate ? 'updated' : 'new';
      record._shopifyId = collection?.id || '';
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
    if (result.processedItems % 5 === 0) await updateProgress(jobId, result);
    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

/**
 * Process order records (read-only update for tags, notes)
 * Orders can't be created via REST API — only updated
 */
async function processOrders(jobId, shopify, records, isCancelled) {
  const result = { processedItems: 0, newItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0, errors: [], processedRecords: [] };

  for (const record of records) {
    if (isCancelled && isCancelled()) break;

    try {
      if (!record.id) {
        record._status = 'skipped';
        record._error = 'Order ID required for updates';
        result.skippedItems++;
        result.processedRecords.push(record);
        continue;
      }

      const command = (record.command || '').toLowerCase().trim();

      if (command === 'close') {
        await shopify.closeOrder(record.id);
        record._status = 'updated';
        record._shopifyId = record.id;
        result.processedItems++;
        result.updatedItems++;
        result.processedRecords.push(record);
        continue;
      }

      if (command === 'cancel') {
        await shopify.cancelOrder(record.id);
        record._status = 'updated';
        record._shopifyId = record.id;
        result.processedItems++;
        result.updatedItems++;
        result.processedRecords.push(record);
        continue;
      }

      const orderData = {};
      if (record.tags) orderData.tags = record.tags;
      if (record.note) orderData.note = record.note;
      if (record.email) orderData.email = record.email;

      const order = await shopify.updateOrder(record.id, orderData);

      record._status = 'updated';
      record._shopifyId = order?.id || record.id;
      result.processedItems++;
      result.updatedItems++;

    } catch (err) {
      record._status = 'failed';
      record._error = err.message;
      result.failedItems++;
      result.errors.push(`Row ${record._line}: ${err.message}`);
    }

    result.processedRecords.push(record);
    if (result.processedItems % 5 === 0) await updateProgress(jobId, result);
    await new Promise(r => setTimeout(r, 250));
  }

  return result;
}

module.exports = { processImportJob };
