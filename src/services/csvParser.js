const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const fs = require('fs');
const path = require('path');

/**
 * Matrixify-compatible CSV column mappings for Blog Posts
 */
const BLOG_POST_COLUMN_MAP = {
  'id': 'id', 'handle': 'handle', 'title': 'title',
  'body html': 'body_html', 'body_html': 'body_html', 'bodyhtml': 'body_html',
  'author': 'author', 'tags': 'tags', 'published': 'published',
  'published at': 'published_at', 'published_at': 'published_at',
  'summary html': 'summary_html', 'summary_html': 'summary_html',
  'template suffix': 'template_suffix', 'template_suffix': 'template_suffix',
  'image: src': 'image_src', 'image: alt': 'image_alt',
  'image:src': 'image_src', 'image:alt': 'image_alt',
  'image_src': 'image_src', 'image_alt': 'image_alt',
  'blog': 'blog_handle', 'blog: handle': 'blog_handle', 'blog:handle': 'blog_handle',
  'blog_handle': 'blog_handle', 'blog: id': 'blog_id', 'blog:id': 'blog_id',
  'blog_id': 'blog_id', 'blog: title': 'blog_title', 'blog:title': 'blog_title',
  'blog_title': 'blog_title',
  'metafield: title_tag [string]': 'seo_title', 'metafield: description_tag [string]': 'seo_description',
  'metafield: title_tag': 'seo_title', 'metafield: description_tag': 'seo_description',
  'seo title': 'seo_title', 'seo_title': 'seo_title',
  'seo description': 'seo_description', 'seo_description': 'seo_description',
  'command': 'command', 'row command': 'command', 'tags command': 'tags_command',
};

/**
 * Matrixify-compatible CSV column mappings for Pages
 */
const PAGE_COLUMN_MAP = {
  'id': 'id', 'handle': 'handle', 'title': 'title',
  'body html': 'body_html', 'body_html': 'body_html',
  'author': 'author', 'published': 'published',
  'published at': 'published_at', 'published_at': 'published_at',
  'template suffix': 'template_suffix', 'template_suffix': 'template_suffix',
  'metafield: title_tag [string]': 'seo_title', 'metafield: description_tag [string]': 'seo_description',
  'metafield: title_tag': 'seo_title', 'metafield: description_tag': 'seo_description',
  'seo title': 'seo_title', 'seo_title': 'seo_title',
  'seo description': 'seo_description', 'seo_description': 'seo_description',
  'command': 'command',
};

/**
 * Matrixify-compatible CSV column mappings for Products
 */
const PRODUCT_COLUMN_MAP = {
  'id': 'id', 'handle': 'handle', 'title': 'title',
  'body html': 'body_html', 'body_html': 'body_html',
  'vendor': 'vendor', 'product type': 'product_type', 'product_type': 'product_type',
  'tags': 'tags', 'published': 'published', 'status': 'status',
  'template suffix': 'template_suffix', 'template_suffix': 'template_suffix',
  'option1 name': 'option1_name', 'option1_name': 'option1_name',
  'option1 value': 'option1_value', 'option1_value': 'option1_value',
  'option2 name': 'option2_name', 'option2_name': 'option2_name',
  'option2 value': 'option2_value', 'option2_value': 'option2_value',
  'option3 name': 'option3_name', 'option3_name': 'option3_name',
  'option3 value': 'option3_value', 'option3_value': 'option3_value',
  'variant id': 'variant_id', 'variant_id': 'variant_id',
  'variant sku': 'variant_sku', 'variant_sku': 'variant_sku',
  'variant price': 'variant_price', 'variant_price': 'variant_price',
  'variant compare at price': 'variant_compare_at_price', 'variant_compare_at_price': 'variant_compare_at_price',
  'variant grams': 'variant_grams', 'variant_grams': 'variant_grams',
  'variant weight': 'variant_weight', 'variant_weight': 'variant_weight',
  'variant weight unit': 'variant_weight_unit', 'variant_weight_unit': 'variant_weight_unit',
  'variant inventory qty': 'variant_inventory_qty', 'variant_inventory_qty': 'variant_inventory_qty',
  'variant barcode': 'variant_barcode', 'variant_barcode': 'variant_barcode',
  'variant requires shipping': 'variant_requires_shipping', 'variant_requires_shipping': 'variant_requires_shipping',
  'variant taxable': 'variant_taxable', 'variant_taxable': 'variant_taxable',
  'image: src': 'image_src', 'image: alt': 'image_alt',
  'image_src': 'image_src', 'image_alt': 'image_alt',
  'seo title': 'seo_title', 'seo_title': 'seo_title',
  'seo description': 'seo_description', 'seo_description': 'seo_description',
  'metafield: title_tag [string]': 'seo_title', 'metafield: description_tag [string]': 'seo_description',
  'command': 'command',
};

/**
 * Matrixify-compatible CSV column mappings for Customers
 */
const CUSTOMER_COLUMN_MAP = {
  'id': 'id', 'first name': 'first_name', 'first_name': 'first_name',
  'last name': 'last_name', 'last_name': 'last_name',
  'email': 'email', 'phone': 'phone', 'tags': 'tags', 'note': 'note',
  'tax exempt': 'tax_exempt', 'tax_exempt': 'tax_exempt',
  'address1': 'address1', 'address2': 'address2', 'city': 'city',
  'province': 'province', 'province code': 'province_code', 'province_code': 'province_code',
  'country': 'country', 'country code': 'country_code', 'country_code': 'country_code',
  'zip': 'zip', 'company': 'company',
  'command': 'command',
};

/**
 * Column mappings for Redirects
 */
const REDIRECT_COLUMN_MAP = {
  'id': 'id', 'path': 'path', 'target': 'target',
  'command': 'command',
};

/**
 * Column mappings for Custom Collections
 */
const CUSTOM_COLLECTION_COLUMN_MAP = {
  'id': 'id', 'handle': 'handle', 'title': 'title',
  'body html': 'body_html', 'body_html': 'body_html',
  'published': 'published', 'sort order': 'sort_order', 'sort_order': 'sort_order',
  'template suffix': 'template_suffix', 'template_suffix': 'template_suffix',
  'image: src': 'image_src', 'image: alt': 'image_alt',
  'image_src': 'image_src', 'image_alt': 'image_alt',
  'command': 'command',
};

/**
 * Column mappings for Smart Collections
 */
const SMART_COLLECTION_COLUMN_MAP = {
  'id': 'id', 'handle': 'handle', 'title': 'title',
  'body html': 'body_html', 'body_html': 'body_html',
  'published': 'published', 'sort order': 'sort_order', 'sort_order': 'sort_order',
  'template suffix': 'template_suffix', 'template_suffix': 'template_suffix',
  'disjunctive': 'disjunctive', 'rules': 'rules',
  'command': 'command',
};

/**
 * Column mappings for Orders
 */
const ORDER_COLUMN_MAP = {
  'id': 'id', 'name': 'name', 'email': 'email',
  'tags': 'tags', 'note': 'note',
  'command': 'command',
};

/**
 * Get column map for a resource type
 */
function getColumnMap(resourceType) {
  switch (resourceType?.toLowerCase?.() || resourceType) {
    case 'blog_posts': case 'blog_post': case 'Blog Posts': case 'Blog Post':
      return BLOG_POST_COLUMN_MAP;
    case 'pages': case 'page': case 'Pages': case 'Page':
      return PAGE_COLUMN_MAP;
    case 'products': case 'product': case 'Products': case 'Product':
      return PRODUCT_COLUMN_MAP;
    case 'customers': case 'customer': case 'Customers': case 'Customer':
      return CUSTOMER_COLUMN_MAP;
    case 'redirects': case 'redirect': case 'Redirects':
      return REDIRECT_COLUMN_MAP;
    case 'custom_collections': case 'collections': case 'Custom Collections':
      return CUSTOM_COLLECTION_COLUMN_MAP;
    case 'smart_collections': case 'Smart Collections':
      return SMART_COLLECTION_COLUMN_MAP;
    case 'orders': case 'order': case 'Orders':
      return ORDER_COLUMN_MAP;
    default:
      return BLOG_POST_COLUMN_MAP;
  }
}

/**
 * Parse a CSV file and normalize columns
 */
async function parseCSV(filePath, resourceType = 'blog_posts') {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    const columnMap = getColumnMap(resourceType);
    let lineNumber = 0;

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        lineNumber++;
        try {
          const normalized = normalizeRecord(record, columnMap, lineNumber);
          if (normalized) results.push(normalized);
        } catch (err) {
          errors.push({ line: lineNumber + 1, error: err.message });
        }
      }
    });

    parser.on('error', reject);
    parser.on('end', () => resolve({ records: results, errors, totalLines: lineNumber }));

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    parser.write(fileContent);
    parser.end();
  });
}

/**
 * Parse CSV from a string buffer
 */
async function parseCSVString(csvString, resourceType = 'blog_posts') {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    const columnMap = getColumnMap(resourceType);
    let lineNumber = 0;

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        lineNumber++;
        try {
          const normalized = normalizeRecord(record, columnMap, lineNumber);
          if (normalized) results.push(normalized);
        } catch (err) {
          errors.push({ line: lineNumber + 1, error: err.message });
        }
      }
    });

    parser.on('error', reject);
    parser.on('end', () => resolve({ records: results, errors, totalLines: lineNumber }));

    parser.write(csvString);
    parser.end();
  });
}

/**
 * Normalize a CSV record using column mapping
 */
function normalizeRecord(record, columnMap, lineNumber) {
  const normalized = { _line: lineNumber, _metafields: {} };
  let hasData = false;

  for (const [csvCol, value] of Object.entries(record)) {
    if (!value || value.trim() === '') continue;

    const lowerCol = csvCol.toLowerCase().trim();

    if (columnMap[lowerCol]) {
      normalized[columnMap[lowerCol]] = value.trim();
      hasData = true;
    } else if (lowerCol.startsWith('metafield:')) {
      const metaKey = lowerCol.replace('metafield:', '').trim();
      const typeMatch = metaKey.match(/^(.+?)\s*\[(.+?)\]$/);
      if (typeMatch) {
        normalized._metafields[typeMatch[1].trim()] = { value: value.trim(), type: typeMatch[2].trim() };
      } else {
        normalized._metafields[metaKey] = { value: value.trim(), type: 'string' };
      }
      hasData = true;
    }
  }

  return hasData ? normalized : null;
}

/**
 * Generate a results CSV from processed records
 */
async function generateResultsCSV(records) {
  return new Promise((resolve, reject) => {
    const rows = records.map(r => ({
      'Row': r._line || '',
      'Handle': r.handle || '',
      'Title': r.title || r.first_name || r.path || '',
      'Status': r._status || 'unknown',
      'Shopify ID': r._shopifyId || '',
      'Error': r._error || '',
    }));

    stringify(rows, { header: true }, (err, output) => {
      if (err) reject(err);
      else resolve(output);
    });
  });
}

module.exports = {
  parseCSV,
  parseCSVString,
  generateResultsCSV,
  getColumnMap,
  BLOG_POST_COLUMN_MAP,
  PAGE_COLUMN_MAP,
  PRODUCT_COLUMN_MAP,
  CUSTOMER_COLUMN_MAP,
  REDIRECT_COLUMN_MAP,
  CUSTOM_COLLECTION_COLUMN_MAP,
  SMART_COLLECTION_COLUMN_MAP,
  ORDER_COLUMN_MAP,
};
