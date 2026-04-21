/**
 * Shopify Admin API service
 * Handles all Shopify REST Admin API calls for all resource types.
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

    // Rate limiting
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
      body: JSON.stringify({ blog: { title, handle } }),
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
    await this.request(`/blogs/${blogId}/articles/${articleId}.json`, { method: 'DELETE' });
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

  // ─── PRODUCTS ───────────────────────────────────────

  async getProducts(params = {}) {
    const query = new URLSearchParams(params).toString();
    const data = await this.request(`/products.json${query ? '?' + query : ''}`);
    return data.products;
  }

  async getProductCount() {
    const data = await this.request('/products/count.json');
    return data.count;
  }

  async getProductByHandle(handle) {
    const products = await this.getProducts({ handle });
    return products[0] || null;
  }

  async getProductById(id) {
    const data = await this.request(`/products/${id}.json`);
    return data.product;
  }

  async createProduct(productData) {
    const data = await this.request('/products.json', {
      method: 'POST',
      body: JSON.stringify({ product: productData }),
    });
    return data.product;
  }

  async updateProduct(id, productData) {
    const data = await this.request(`/products/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ product: productData }),
    });
    return data.product;
  }

  async deleteProduct(id) {
    await this.request(`/products/${id}.json`, { method: 'DELETE' });
    return true;
  }

  // ─── VARIANTS ───────────────────────────────────────

  async updateVariant(variantId, variantData) {
    const data = await this.request(`/variants/${variantId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ variant: variantData }),
    });
    return data.variant;
  }

  // ─── CUSTOMERS ──────────────────────────────────────

  async getCustomers(params = {}) {
    const query = new URLSearchParams(params).toString();
    const data = await this.request(`/customers.json${query ? '?' + query : ''}`);
    return data.customers;
  }

  async searchCustomersByEmail(email) {
    const data = await this.request(`/customers/search.json?query=email:${encodeURIComponent(email)}`);
    return data.customers;
  }

  async createCustomer(customerData) {
    const data = await this.request('/customers.json', {
      method: 'POST',
      body: JSON.stringify({ customer: customerData }),
    });
    return data.customer;
  }

  async updateCustomer(id, customerData) {
    const data = await this.request(`/customers/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ customer: customerData }),
    });
    return data.customer;
  }

  async deleteCustomer(id) {
    await this.request(`/customers/${id}.json`, { method: 'DELETE' });
    return true;
  }

  // ─── ORDERS ─────────────────────────────────────────

  async getOrders(params = {}) {
    const query = new URLSearchParams(params).toString();
    const data = await this.request(`/orders.json${query ? '?' + query : ''}`);
    return data.orders;
  }

  async updateOrder(id, orderData) {
    const data = await this.request(`/orders/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ order: orderData }),
    });
    return data.order;
  }

  async closeOrder(id) {
    const data = await this.request(`/orders/${id}/close.json`, { method: 'POST' });
    return data.order;
  }

  async cancelOrder(id) {
    const data = await this.request(`/orders/${id}/cancel.json`, { method: 'POST' });
    return data.order;
  }

  // ─── REDIRECTS ──────────────────────────────────────

  async getRedirects(params = {}) {
    const query = new URLSearchParams(params).toString();
    const data = await this.request(`/redirects.json${query ? '?' + query : ''}`);
    return data.redirects;
  }

  async createRedirect(redirectData) {
    const data = await this.request('/redirects.json', {
      method: 'POST',
      body: JSON.stringify({ redirect: redirectData }),
    });
    return data.redirect;
  }

  async updateRedirect(id, redirectData) {
    const data = await this.request(`/redirects/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ redirect: redirectData }),
    });
    return data.redirect;
  }

  async deleteRedirect(id) {
    await this.request(`/redirects/${id}.json`, { method: 'DELETE' });
    return true;
  }

  // ─── CUSTOM COLLECTIONS ─────────────────────────────

  async getCustomCollections(params = {}) {
    const query = new URLSearchParams(params).toString();
    const data = await this.request(`/custom_collections.json${query ? '?' + query : ''}`);
    return data.custom_collections;
  }

  async getCustomCollectionByHandle(handle) {
    const collections = await this.getCustomCollections({ handle });
    return collections[0] || null;
  }

  async createCustomCollection(collectionData) {
    const data = await this.request('/custom_collections.json', {
      method: 'POST',
      body: JSON.stringify({ custom_collection: collectionData }),
    });
    return data.custom_collection;
  }

  async updateCustomCollection(id, collectionData) {
    const data = await this.request(`/custom_collections/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ custom_collection: collectionData }),
    });
    return data.custom_collection;
  }

  async deleteCustomCollection(id) {
    await this.request(`/custom_collections/${id}.json`, { method: 'DELETE' });
    return true;
  }

  // ─── SMART COLLECTIONS ──────────────────────────────

  async getSmartCollections(params = {}) {
    const query = new URLSearchParams(params).toString();
    const data = await this.request(`/smart_collections.json${query ? '?' + query : ''}`);
    return data.smart_collections;
  }

  async getSmartCollectionByHandle(handle) {
    const collections = await this.getSmartCollections({ handle });
    return collections[0] || null;
  }

  async createSmartCollection(collectionData) {
    const data = await this.request('/smart_collections.json', {
      method: 'POST',
      body: JSON.stringify({ smart_collection: collectionData }),
    });
    return data.smart_collection;
  }

  async updateSmartCollection(id, collectionData) {
    const data = await this.request(`/smart_collections/${id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ smart_collection: collectionData }),
    });
    return data.smart_collection;
  }

  async deleteSmartCollection(id) {
    await this.request(`/smart_collections/${id}.json`, { method: 'DELETE' });
    return true;
  }

  // ─── METAFIELDS ─────────────────────────────────────

  async setMetafield(ownerId, ownerResource, namespace, key, value, type = 'single_line_text_field') {
    const data = await this.request('/metafields.json', {
      method: 'POST',
      body: JSON.stringify({
        metafield: { owner_id: ownerId, owner_resource: ownerResource, namespace, key, value, type },
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

  // ─── BILLING (Recurring Application Charges) ────────

  async createRecurringCharge(chargeData) {
    const data = await this.request('/recurring_application_charges.json', {
      method: 'POST',
      body: JSON.stringify({ recurring_application_charge: chargeData }),
    });
    return data.recurring_application_charge;
  }

  async getRecurringCharge(chargeId) {
    const data = await this.request(`/recurring_application_charges/${chargeId}.json`);
    return data.recurring_application_charge;
  }

  async activateRecurringCharge(chargeId) {
    const data = await this.request(`/recurring_application_charges/${chargeId}/activate.json`, {
      method: 'POST',
    });
    return data.recurring_application_charge;
  }

  async cancelRecurringCharge(chargeId) {
    await this.request(`/recurring_application_charges/${chargeId}.json`, {
      method: 'DELETE',
    });
    return true;
  }

  async getActiveRecurringCharges() {
    const data = await this.request('/recurring_application_charges.json');
    return (data.recurring_application_charges || []).filter(c => c.status === 'active');
  }
}

module.exports = ShopifyAPI;
