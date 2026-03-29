/**
 * Shopify Admin API service
 * Handles all Shopify REST Admin API calls for blog posts, pages, etc.
 */

const API_VERSION = '2024-10';

class ShopifyAPI {
  constructor(shopDomain, accessToken) {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
    this.baseUrl = `https://${shopDomain}/admin/api/${API_VERSION}`;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken,
        ...options.headers,
      },
    });

    // Rate limiting - respect Shopify's limits
    const callLimit = response.headers.get('x-shopify-shop-api-call-limit');
    if (callLimit) {
      const [used, max] = callLimit.split('/').map(Number);
      if (used >= max - 2) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!response.ok) {
      const errorBody = await response.text();
      const error = new Error(`Shopify API error ${response.status}: ${errorBody}`);
      error.status = response.status;
      error.body = errorBody;
      throw error;
    }

    if (response.status === 204) return null;
    return response.json();
  }

  // ─── BLOGS ───────────────────────────────────────────

  async getBlogs() {
    const data = await this.request('/blogs.json');
    return data.blogs;
  }

  async getBlogByHandle(handle) {
    const blogs = await this.getBlogs();
    return blogs.find(b => b.handle === handle);
  }

  async getBlogById(id) {
    const data = await this.request(`/blogs/${id}.json`);
    return data.blog;
  }

  async createBlog(title, handle) {
    const data = await this.request('/blogs.json', {
      method: 'POST',
      body: JSON.stringify({
        blog: { title, handle }
      }),
    });
    return data.blog;
  }

  // ─── BLOG POSTS (ARTICLES) ──────────────────────────

  async getArticles(blogId, params = {}) {
    const query = new URLSearchParams(params).toString();
    const endpoint = `/blogs/${blogId}/articles.json${query ? '?' + query : ''}`;
    const data = await this.request(endpoint);
    return data.articles;
  }

  async getArticleByHandle(blogId, handle) {
    const articles = await this.getArticles(blogId, { handle });
    return articles[0] || null;
  }

  async createArticle(blogId, articleData) {
    const data = await this.request(`/blogs/${blogId}/articles.json`, {
      method: 'POST',
      body: JSON.stringify({ article: articleData }),
    });
    return data.article;
  }

  async updateArticle(blogId, articleId, articleData) {
    const data = await this.request(`/blogs/${blogId}/articles/${articleId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ article: articleData }),
    });
    return data.article;
  }

  async deleteArticle(blogId, articleId) {
    await this.request(`/blogs/${blogId}/articles/${articleId}.json`, {
      method: 'DELETE',
    });
    return true;
  }

  // ─── PAGES ──────────────────────────────────────────

  async getPages(params = {}) {
    const query = new URLSearchParams(params).toString();
    const data = await this.request(`/pages.json${query ? '?' + query : ''}`);
    return data.pages;
  }

  async getPageByHandle(handle) {
    const pages = await this.getPages({ handle });
    return pages[0] || null;
  }

  async createPage(pageData) {
    const data = await this.request('/pages.json', {
      method: 'POST',
      body: JSON.stringify({ page: pageData }),
    });
    return data.page;
  }

  async updatePage(pageId, pageData) {
    const data = await this.request(`/pages/${pageId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ page: pageData }),
    });
    return data.page;
  }

  async deletePage(pageId) {
    await this.request(`/pages/${pageId}.json`, { method: 'DELETE' });
    return true;
  }

  // ─── METAFIELDS ─────────────────────────────────────

  async setMetafield(ownerId, ownerResource, namespace, key, value, type = 'single_line_text_field') {
    const data = await this.request('/metafields.json', {
      method: 'POST',
      body: JSON.stringify({
        metafield: {
          owner_id: ownerId,
          owner_resource: ownerResource,
          namespace,
          key,
          value,
          type,
        }
      }),
    });
    return data.metafield;
  }

  async setArticleMetafields(articleId, metafields) {
    const results = [];
    for (const [fullKey, meta] of Object.entries(metafields)) {
      const parts = fullKey.split('.');
      const namespace = parts.length > 1 ? parts[0] : 'global';
      const key = parts.length > 1 ? parts.slice(1).join('.') : fullKey;

      // Map common type names
      let type = meta.type || 'single_line_text_field';
      if (type === 'string') type = 'single_line_text_field';
      if (type === 'integer') type = 'number_integer';

      try {
        const result = await this.setMetafield(articleId, 'article', namespace, key, meta.value, type);
        results.push(result);
      } catch (err) {
        console.error(`Failed to set metafield ${fullKey}:`, err.message);
      }
    }
    return results;
  }

  // ─── SHOP INFO ──────────────────────────────────────

  async getShopInfo() {
    const data = await this.request('/shop.json');
    return data.shop;
  }

  // ─── PRODUCTS (for future expansion) ────────────────

  async getProducts(params = {}) {
    const query = new URLSearchParams(params).toString();
    const data = await this.request(`/products.json${query ? '?' + query : ''}`);
    return data.products;
  }

  async getProductCount() {
    const data = await this.request('/products/count.json');
    return data.count;
  }
}

module.exports = ShopifyAPI;
