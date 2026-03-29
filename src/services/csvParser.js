const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const fs = require('fs');
const path = require('path');

/**
 * Matrixify-compatible CSV column mappings for Blog Posts
 *
 * Matrixify columns → Shopify API fields
 */
const BLOG_POST_COLUMN_MAP = {
  // Core fields
  'id': 'id',
  'handle': 'handle',
  'title': 'title',
  'body html': 'body_html',
  'body_html': 'body_html',
  'bodyhtml': 'body_html',
  'author': 'author',
  'tags': 'tags',
  'published': 'published',
  'published at': 'published_at',
  'published_at': 'published_at',
  'summary html': 'summary_html',
  'summary_html': 'summary_html',
  'template suffix': 'template_suffix',
  'template_suffix': 'template_suffix',
  'image: src': 'image_src',
  'image: alt': 'image_alt',
  'image:src': 'image_src',
  'image:alt': 'image_alt',
  'image_src': 'image_src',
  'image_alt': 'image_alt',

  // Blog reference
  'blog': 'blog_handle',
  'blog: handle': 'blog_handle',
  'blog:handle': 'blog_handle',
  'blog_handle': 'blog_handle',
  'blog: id': 'blog_id',
  'blog:id': 'blog_id',
  'blog_id': 'blog_id',
  'blog: title': 'blog_title',
  'blog:title': 'blog_title',
  'blog_title': 'blog_title',

  // SEO metafields
  'metafield: title_tag [string]': 'seo_title',
  'metafield: description_tag [string]': 'seo_description',
  'metafield: title_tag': 'seo_title',
  'metafield: description_tag': 'seo_description',
  'seo title': 'seo_title',
  'seo_title': 'seo_title',
  'seo description': 'seo_description',
  'seo_description': 'seo_description',

  // Command column (for update/delete operations)
  'command': 'command',
  'row command': 'command',
  'tags command': 'tags_command',
};

/**
 * Matrixify-compatible CSV column mappings for Pages
 */
const PAGE_COLUMN_MAP = {
  'id': 'id',
  'handle': 'handle',
  'title': 'title',
  'body html': 'body_html',
  'body_html': 'body_html',
  'author': 'author',
  'published': 'published',
  'published at': 'published_at',
  'published_at': 'published_at',
  'template suffix': 'template_suffix',
  'template_suffix': 'template_suffix',
  'metafield: title_tag [string]': 'seo_title',
  'metafield: description_tag [string]': 'seo_description',
  'metafield: title_tag': 'seo_title',
  'metafield: description_tag': 'seo_description',
  'seo title': 'seo_title',
  'seo_title': 'seo_title',
  'seo description': 'seo_description',
  'seo_description': 'seo_description',
  'command': 'command',
};

/**
 * Get column map for a resource type
 */
function getColumnMap(resourceType) {
  switch (resourceType) {
    case 'blog_posts':
    case 'blog_post':
    case 'Blog Posts':
    case 'Blog Post':
      return BLOG_POST_COLUMN_MAP;
    case 'pages':
    case 'page':
    case 'Pages':
    case 'Page':
      return PAGE_COLUMN_MAP;
    default:
      return BLOG_POST_COLUMN_MAP;
  }
}

/**
 * Parse a CSV file and normalize columns to Matrixify-compatible format
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
          if (normalized) {
            results.push(normalized);
          }
        } catch (err) {
          errors.push({ line: lineNumber + 1, error: err.message });
        }
      }
    });

    parser.on('error', (err) => {
      reject(err);
    });

    parser.on('end', () => {
      resolve({ records: results, errors, totalLines: lineNumber });
    });

    // Read file and pipe to parser
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
          if (normalized) {
            results.push(normalized);
          }
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

    // Check if it's a mapped column
    if (columnMap[lowerCol]) {
      normalized[columnMap[lowerCol]] = value.trim();
      hasData = true;
    }
    // Check for metafield columns: "Metafield: namespace.key [type]"
    else if (lowerCol.startsWith('metafield:')) {
      const metaKey = lowerCol.replace('metafield:', '').trim();
      // Parse "namespace.key [type]" or just "namespace.key"
      const typeMatch = metaKey.match(/^(.+?)\s*\[(.+?)\]$/);
      if (typeMatch) {
        normalized._metafields[typeMatch[1].trim()] = {
          value: value.trim(),
          type: typeMatch[2].trim()
        };
      } else {
        normalized._metafields[metaKey] = {
          value: value.trim(),
          type: 'string'
        };
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
      'Title': r.title || '',
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
};
