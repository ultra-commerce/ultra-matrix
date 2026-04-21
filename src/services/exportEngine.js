/**
 * Export Engine
 * Exports Shopify resources to Matrixify-compatible CSV files.
 * Called by the job queue worker.
 */

const { Job } = require('./database');
const ShopifyAPI = require('./shopifyApi');
const { stringify } = require('csv-stringify/sync');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Process an export job (called by the queue worker)
 */
async function processExportJob({ jobId, shopDomain, accessToken, resourceType, isCancelled }) {
  const shopify = new ShopifyAPI(shopDomain, accessToken);

  let records = [];

  switch (resourceType) {
    case 'blog_posts':
      records = await exportBlogPosts(shopify, isCancelled);
      break;
    case 'pages':
      records = await exportPages(shopify, isCancelled);
      break;
    case 'products':
      records = await exportProducts(shopify, isCancelled);
      break;
    case 'customers':
      records = await exportCustomers(shopify, isCancelled);
      break;
    case 'orders':
      records = await exportOrders(shopify, isCancelled);
      break;
    case 'redirects':
      records = await exportRedirects(shopify, isCancelled);
      break;
    case 'custom_collections':
    case 'collections':
      records = await exportCustomCollections(shopify, isCancelled);
      break;
    case 'smart_collections':
      records = await exportSmartCollections(shopify, isCancelled);
      break;
    default:
      throw new Error(`Unsupported export resource type: ${resourceType}`);
  }

  await Job.update(jobId, {
    totalItems: records.length,
    processedItems: records.length,
  });

  // Generate CSV
  const resultsDir = path.join(__dirname, '..', '..', 'uploads', 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const fileName = `Export_${resourceType}_${new Date().toISOString().slice(0, 10)}_${jobId.slice(0, 8)}.csv`;
  const resultFilePath = path.join(resultsDir, fileName);

  if (records.length > 0) {
    const csv = stringify(records, { header: true });
    fs.writeFileSync(resultFilePath, csv);
  } else {
    fs.writeFileSync(resultFilePath, 'No records found');
  }

  const job = await Job.findById(jobId);
  const duration = job.startedAt ? Math.round((new Date() - new Date(job.startedAt)) / 1000) : 0;

  const wasCancelled = isCancelled && isCancelled();

  await Job.update(jobId, {
    status: wasCancelled ? 'cancelled' : 'completed',
    completedAt: new Date().toISOString(),
    duration,
    newItems: records.length,
    resultFilePath,
    fileName,
  });
}

/**
 * Paginate through all resources using Shopify's link-based pagination
 */
async function paginateAll(fetchFn, params = {}, isCancelled) {
  const allItems = [];
  let page = 1;
  const limit = params.limit || 250;

  while (true) {
    if (isCancelled && isCancelled()) break;

    const items = await fetchFn({ ...params, limit, page });
    if (!items || items.length === 0) break;
    allItems.push(...items);

    if (items.length < limit) break; // Last page
    page++;

    await new Promise(r => setTimeout(r, 500)); // Rate limit
  }

  return allItems;
}

/**
 * Export Blog Posts
 */
async function exportBlogPosts(shopify, isCancelled) {
  const blogs = await shopify.getBlogs();
  const records = [];

  for (const blog of blogs) {
    if (isCancelled && isCancelled()) break;

    const articles = await paginateAll(
      (p) => shopify.getArticles(blog.id, p),
      {},
      isCancelled
    );

    for (const article of articles) {
      records.push({
        'ID': article.id,
        'Handle': article.handle || '',
        'Title': article.title || '',
        'Body HTML': article.body_html || '',
        'Author': article.author || '',
        'Tags': article.tags || '',
        'Published': article.published_at ? 'true' : 'false',
        'Published At': article.published_at || '',
        'Summary HTML': article.summary_html || '',
        'Template Suffix': article.template_suffix || '',
        'Blog: Handle': blog.handle || '',
        'Blog: Title': blog.title || '',
        'Blog: ID': blog.id,
        'Image: Src': article.image?.src || '',
        'Image: Alt': article.image?.alt || '',
        'Created At': article.created_at || '',
        'Updated At': article.updated_at || '',
      });
    }
  }

  return records;
}

/**
 * Export Pages
 */
async function exportPages(shopify, isCancelled) {
  const pages = await paginateAll(
    (p) => shopify.getPages(p),
    {},
    isCancelled
  );

  return pages.map(page => ({
    'ID': page.id,
    'Handle': page.handle || '',
    'Title': page.title || '',
    'Body HTML': page.body_html || '',
    'Author': page.author || '',
    'Published': page.published_at ? 'true' : 'false',
    'Published At': page.published_at || '',
    'Template Suffix': page.template_suffix || '',
    'Created At': page.created_at || '',
    'Updated At': page.updated_at || '',
  }));
}

/**
 * Export Products
 */
async function exportProducts(shopify, isCancelled) {
  const products = await paginateAll(
    (p) => shopify.getProducts(p),
    {},
    isCancelled
  );

  const records = [];

  for (const product of products) {
    // If product has variants, create a row per variant
    const variants = product.variants || [{}];
    const images = product.images || [];

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      const image = images[i] || images[0] || {};

      records.push({
        'ID': product.id,
        'Handle': product.handle || '',
        'Title': product.title || '',
        'Body HTML': i === 0 ? (product.body_html || '') : '',
        'Vendor': product.vendor || '',
        'Product Type': product.product_type || '',
        'Tags': i === 0 ? (product.tags || '') : '',
        'Published': product.status === 'active' ? 'true' : 'false',
        'Status': product.status || '',
        'Template Suffix': product.template_suffix || '',
        'Option1 Name': product.options?.[0]?.name || '',
        'Option1 Value': variant.option1 || '',
        'Option2 Name': product.options?.[1]?.name || '',
        'Option2 Value': variant.option2 || '',
        'Option3 Name': product.options?.[2]?.name || '',
        'Option3 Value': variant.option3 || '',
        'Variant ID': variant.id || '',
        'Variant SKU': variant.sku || '',
        'Variant Price': variant.price || '',
        'Variant Compare At Price': variant.compare_at_price || '',
        'Variant Grams': variant.grams || '',
        'Variant Weight': variant.weight || '',
        'Variant Weight Unit': variant.weight_unit || '',
        'Variant Inventory Qty': variant.inventory_quantity || '',
        'Variant Barcode': variant.barcode || '',
        'Variant Requires Shipping': variant.requires_shipping ?? '',
        'Variant Taxable': variant.taxable ?? '',
        'Image: Src': image.src || '',
        'Image: Alt': image.alt || '',
        'Created At': product.created_at || '',
        'Updated At': product.updated_at || '',
      });
    }
  }

  return records;
}

/**
 * Export Customers
 */
async function exportCustomers(shopify, isCancelled) {
  const customers = await paginateAll(
    (p) => shopify.getCustomers(p),
    {},
    isCancelled
  );

  return customers.map(c => {
    const addr = c.default_address || c.addresses?.[0] || {};
    return {
      'ID': c.id,
      'First Name': c.first_name || '',
      'Last Name': c.last_name || '',
      'Email': c.email || '',
      'Phone': c.phone || '',
      'Tags': c.tags || '',
      'Note': c.note || '',
      'Tax Exempt': c.tax_exempt ? 'true' : 'false',
      'Total Orders': c.orders_count || 0,
      'Total Spent': c.total_spent || '0.00',
      'Address1': addr.address1 || '',
      'Address2': addr.address2 || '',
      'City': addr.city || '',
      'Province': addr.province || '',
      'Province Code': addr.province_code || '',
      'Country': addr.country || '',
      'Country Code': addr.country_code || '',
      'Zip': addr.zip || '',
      'Company': addr.company || '',
      'Created At': c.created_at || '',
      'Updated At': c.updated_at || '',
    };
  });
}

/**
 * Export Orders
 */
async function exportOrders(shopify, isCancelled) {
  const orders = await paginateAll(
    (p) => shopify.getOrders({ ...p, status: 'any' }),
    {},
    isCancelled
  );

  const records = [];

  for (const order of orders) {
    const lineItems = order.line_items || [{}];

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      records.push({
        'ID': order.id,
        'Name': order.name || '',
        'Email': i === 0 ? (order.email || '') : '',
        'Financial Status': i === 0 ? (order.financial_status || '') : '',
        'Fulfillment Status': i === 0 ? (order.fulfillment_status || '') : '',
        'Total Price': i === 0 ? (order.total_price || '') : '',
        'Subtotal Price': i === 0 ? (order.subtotal_price || '') : '',
        'Total Tax': i === 0 ? (order.total_tax || '') : '',
        'Currency': i === 0 ? (order.currency || '') : '',
        'Tags': i === 0 ? (order.tags || '') : '',
        'Note': i === 0 ? (order.note || '') : '',
        'Line Item: Title': item.title || '',
        'Line Item: SKU': item.sku || '',
        'Line Item: Quantity': item.quantity || '',
        'Line Item: Price': item.price || '',
        'Line Item: Variant ID': item.variant_id || '',
        'Line Item: Product ID': item.product_id || '',
        'Shipping: Name': i === 0 ? (order.shipping_address?.name || '') : '',
        'Shipping: Address1': i === 0 ? (order.shipping_address?.address1 || '') : '',
        'Shipping: City': i === 0 ? (order.shipping_address?.city || '') : '',
        'Shipping: Province': i === 0 ? (order.shipping_address?.province || '') : '',
        'Shipping: Country': i === 0 ? (order.shipping_address?.country || '') : '',
        'Shipping: Zip': i === 0 ? (order.shipping_address?.zip || '') : '',
        'Created At': i === 0 ? (order.created_at || '') : '',
        'Processed At': i === 0 ? (order.processed_at || '') : '',
        'Closed At': i === 0 ? (order.closed_at || '') : '',
      });
    }
  }

  return records;
}

/**
 * Export Redirects
 */
async function exportRedirects(shopify, isCancelled) {
  const redirects = await paginateAll(
    (p) => shopify.getRedirects(p),
    {},
    isCancelled
  );

  return redirects.map(r => ({
    'ID': r.id,
    'Path': r.path || '',
    'Target': r.target || '',
  }));
}

/**
 * Export Custom Collections
 */
async function exportCustomCollections(shopify, isCancelled) {
  const collections = await paginateAll(
    (p) => shopify.getCustomCollections(p),
    {},
    isCancelled
  );

  return collections.map(c => ({
    'ID': c.id,
    'Handle': c.handle || '',
    'Title': c.title || '',
    'Body HTML': c.body_html || '',
    'Published': c.published_at ? 'true' : 'false',
    'Sort Order': c.sort_order || '',
    'Template Suffix': c.template_suffix || '',
    'Image: Src': c.image?.src || '',
    'Image: Alt': c.image?.alt || '',
    'Created At': c.created_at || '',
    'Updated At': c.updated_at || '',
  }));
}

/**
 * Export Smart Collections
 */
async function exportSmartCollections(shopify, isCancelled) {
  const collections = await paginateAll(
    (p) => shopify.getSmartCollections(p),
    {},
    isCancelled
  );

  return collections.map(c => ({
    'ID': c.id,
    'Handle': c.handle || '',
    'Title': c.title || '',
    'Body HTML': c.body_html || '',
    'Published': c.published_at ? 'true' : 'false',
    'Sort Order': c.sort_order || '',
    'Template Suffix': c.template_suffix || '',
    'Disjunctive': c.disjunctive ? 'true' : 'false',
    'Rules': c.rules ? JSON.stringify(c.rules) : '',
    'Created At': c.created_at || '',
    'Updated At': c.updated_at || '',
  }));
}

module.exports = { processExportJob };
