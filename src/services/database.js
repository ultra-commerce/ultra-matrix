/**
 * Database layer using sql.js (pure JS SQLite)
 * Drop-in replacement for Prisma calls used throughout the app
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let db = null;
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'ultra-matrix.db');

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      shopDomain TEXT UNIQUE NOT NULL,
      accessToken TEXT NOT NULL,
      scopes TEXT,
      plan TEXT DEFAULT 'free',
      planExpiresAt TEXT,
      installedAt TEXT DEFAULT (datetime('now')),
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS shop_settings (
      id TEXT PRIMARY KEY,
      shopId TEXT UNIQUE NOT NULL,
      allowExternalDownload INTEGER DEFAULT 0,
      notifyOnComplete INTEGER DEFAULT 1,
      notifyEmail TEXT,
      defaultBlogHandle TEXT DEFAULT 'news',
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shopId) REFERENCES shops(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      shopId TEXT NOT NULL,
      type TEXT NOT NULL,
      resourceType TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      fileName TEXT,
      filePath TEXT,
      totalItems INTEGER DEFAULT 0,
      processedItems INTEGER DEFAULT 0,
      newItems INTEGER DEFAULT 0,
      updatedItems INTEGER DEFAULT 0,
      failedItems INTEGER DEFAULT 0,
      skippedItems INTEGER DEFAULT 0,
      errors TEXT,
      resultFilePath TEXT,
      startedAt TEXT,
      completedAt TEXT,
      duration INTEGER,
      triggeredBy TEXT DEFAULT 'manual',
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shopId) REFERENCES shops(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      shopId TEXT NOT NULL,
      name TEXT NOT NULL,
      key TEXT UNIQUE NOT NULL,
      lastUsedAt TEXT,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shopId) REFERENCES shops(id)
    )
  `);

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper to convert row to object
function rowToObj(row, columns) {
  if (!row) return null;
  const obj = {};
  columns.forEach((col, i) => { obj[col] = row[i]; });
  // Convert integer booleans
  if ('allowExternalDownload' in obj) obj.allowExternalDownload = !!obj.allowExternalDownload;
  if ('notifyOnComplete' in obj) obj.notifyOnComplete = !!obj.notifyOnComplete;
  if ('isActive' in obj) obj.isActive = !!obj.isActive;
  return obj;
}

function allToObj(stmt) {
  const results = [];
  while (stmt.step()) {
    results.push(rowToObj(stmt.get(), stmt.getColumnNames()));
  }
  stmt.free();
  return results;
}

// ─── SHOP ──────────────────────────────────────────

const Shop = {
  async findUnique(shopDomain) {
    const d = await getDb();
    const stmt = d.prepare('SELECT * FROM shops WHERE shopDomain = ?');
    stmt.bind([shopDomain]);
    let shop = null;
    if (stmt.step()) {
      shop = rowToObj(stmt.get(), stmt.getColumnNames());
    }
    stmt.free();
    return shop;
  },

  async findById(id) {
    const d = await getDb();
    const stmt = d.prepare('SELECT * FROM shops WHERE id = ?');
    stmt.bind([id]);
    let shop = null;
    if (stmt.step()) {
      shop = rowToObj(stmt.get(), stmt.getColumnNames());
    }
    stmt.free();
    return shop;
  },

  async findFirst() {
    const d = await getDb();
    const stmt = d.prepare('SELECT * FROM shops LIMIT 1');
    let shop = null;
    if (stmt.step()) {
      shop = rowToObj(stmt.get(), stmt.getColumnNames());
    }
    stmt.free();
    return shop;
  },

  async upsert(shopDomain, data) {
    const existing = await this.findUnique(shopDomain);
    const d = await getDb();
    if (existing) {
      d.run('UPDATE shops SET accessToken = ?, scopes = ?, updatedAt = datetime("now") WHERE shopDomain = ?',
        [data.accessToken, data.scopes || existing.scopes, shopDomain]);
      saveDb();
      return await this.findUnique(shopDomain);
    } else {
      const id = uuidv4();
      d.run('INSERT INTO shops (id, shopDomain, accessToken, scopes) VALUES (?, ?, ?, ?)',
        [id, shopDomain, data.accessToken, data.scopes || '']);
      saveDb();
      return await this.findById(id);
    }
  },

  async delete(id) {
    const d = await getDb();
    d.run('DELETE FROM shops WHERE id = ?', [id]);
    saveDb();
  },

  async withSettings(shopDomain) {
    const shop = await this.findUnique(shopDomain);
    if (!shop) return null;
    shop.settings = await ShopSettings.findByShopId(shop.id);
    return shop;
  }
};

// ─── SHOP SETTINGS ─────────────────────────────────

const ShopSettings = {
  async findByShopId(shopId) {
    const d = await getDb();
    const stmt = d.prepare('SELECT * FROM shop_settings WHERE shopId = ?');
    stmt.bind([shopId]);
    let settings = null;
    if (stmt.step()) {
      settings = rowToObj(stmt.get(), stmt.getColumnNames());
    }
    stmt.free();
    return settings;
  },

  async upsert(shopId, data) {
    const existing = await this.findByShopId(shopId);
    const d = await getDb();
    if (existing) {
      d.run(`UPDATE shop_settings SET
        allowExternalDownload = ?, notifyOnComplete = ?, notifyEmail = ?,
        defaultBlogHandle = ?, updatedAt = datetime("now")
        WHERE shopId = ?`,
        [data.allowExternalDownload ? 1 : 0, data.notifyOnComplete ? 1 : 0,
         data.notifyEmail || null, data.defaultBlogHandle || 'news', shopId]);
    } else {
      const id = uuidv4();
      d.run(`INSERT INTO shop_settings (id, shopId, allowExternalDownload, notifyOnComplete, notifyEmail, defaultBlogHandle)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [id, shopId, data.allowExternalDownload ? 1 : 0, data.notifyOnComplete ? 1 : 0,
         data.notifyEmail || null, data.defaultBlogHandle || 'news']);
    }
    saveDb();
    return await this.findByShopId(shopId);
  },

  async deleteByShopId(shopId) {
    const d = await getDb();
    d.run('DELETE FROM shop_settings WHERE shopId = ?', [shopId]);
    saveDb();
  }
};

// ─── JOB ───────────────────────────────────────────

const Job = {
  async create(data) {
    const d = await getDb();
    const id = uuidv4();
    d.run(`INSERT INTO jobs (id, shopId, type, resourceType, status, fileName, filePath, triggeredBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.shopId, data.type, data.resourceType, data.status || 'pending',
       data.fileName || null, data.filePath || null, data.triggeredBy || 'manual']);
    saveDb();
    return await this.findById(id);
  },

  async findById(id) {
    const d = await getDb();
    const stmt = d.prepare('SELECT * FROM jobs WHERE id = ?');
    stmt.bind([id]);
    let job = null;
    if (stmt.step()) {
      job = rowToObj(stmt.get(), stmt.getColumnNames());
    }
    stmt.free();
    return job;
  },

  async findMany({ shopId, status, orderBy, skip, take, filter } = {}) {
    const d = await getDb();
    let sql = 'SELECT * FROM jobs WHERE 1=1';
    const params = [];

    if (shopId) { sql += ' AND shopId = ?'; params.push(shopId); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (filter) { sql += ' AND (fileName LIKE ? OR id LIKE ?)'; params.push(`%${filter}%`, `%${filter}%`); }

    sql += ' ORDER BY createdAt DESC';
    if (take) { sql += ` LIMIT ${take}`; }
    if (skip) { sql += ` OFFSET ${skip}`; }

    const stmt = d.prepare(sql);
    if (params.length) stmt.bind(params);
    return allToObj(stmt);
  },

  async count({ shopId, status, filter } = {}) {
    const d = await getDb();
    let sql = 'SELECT COUNT(*) as cnt FROM jobs WHERE 1=1';
    const params = [];

    if (shopId) { sql += ' AND shopId = ?'; params.push(shopId); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (filter) { sql += ' AND (fileName LIKE ? OR id LIKE ?)'; params.push(`%${filter}%`, `%${filter}%`); }

    const stmt = d.prepare(sql);
    if (params.length) stmt.bind(params);
    stmt.step();
    const count = stmt.get()[0];
    stmt.free();
    return count;
  },

  async update(id, data) {
    const d = await getDb();
    const sets = [];
    const params = [];

    for (const [key, value] of Object.entries(data)) {
      // Map camelCase to column names
      const col = key;
      sets.push(`${col} = ?`);
      params.push(value);
    }

    sets.push('updatedAt = datetime("now")');
    params.push(id);

    d.run(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`, params);
    saveDb();
    return await this.findById(id);
  },

  async deleteByShopId(shopId) {
    const d = await getDb();
    d.run('DELETE FROM jobs WHERE shopId = ?', [shopId]);
    saveDb();
  }
};

// ─── API KEY ───────────────────────────────────────

const ApiKey = {
  async create(data) {
    const d = await getDb();
    const id = uuidv4();
    d.run('INSERT INTO api_keys (id, shopId, name, key) VALUES (?, ?, ?, ?)',
      [id, data.shopId, data.name, data.key]);
    saveDb();
    return await this.findById(id);
  },

  async findById(id) {
    const d = await getDb();
    const stmt = d.prepare('SELECT * FROM api_keys WHERE id = ?');
    stmt.bind([id]);
    let key = null;
    if (stmt.step()) {
      key = rowToObj(stmt.get(), stmt.getColumnNames());
    }
    stmt.free();
    return key;
  },

  async findByKey(key) {
    const d = await getDb();
    const stmt = d.prepare('SELECT * FROM api_keys WHERE key = ?');
    stmt.bind([key]);
    let result = null;
    if (stmt.step()) {
      result = rowToObj(stmt.get(), stmt.getColumnNames());
    }
    stmt.free();
    if (result) {
      result.shop = await Shop.findById(result.shopId);
      if (result.shop) {
        result.shop.settings = await ShopSettings.findByShopId(result.shop.id);
      }
    }
    return result;
  },

  async findByShopId(shopId) {
    const d = await getDb();
    const stmt = d.prepare('SELECT * FROM api_keys WHERE shopId = ? ORDER BY createdAt DESC');
    stmt.bind([shopId]);
    return allToObj(stmt);
  },

  async update(id, data) {
    const d = await getDb();
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(data)) {
      sets.push(`${key} = ?`);
      params.push(key === 'isActive' ? (value ? 1 : 0) : value);
    }
    sets.push('updatedAt = datetime("now")');
    params.push(id);
    d.run(`UPDATE api_keys SET ${sets.join(', ')} WHERE id = ?`, params);
    saveDb();
  },

  async delete(id) {
    const d = await getDb();
    d.run('DELETE FROM api_keys WHERE id = ?', [id]);
    saveDb();
  },

  async deleteByShopId(shopId) {
    const d = await getDb();
    d.run('DELETE FROM api_keys WHERE shopId = ?', [shopId]);
    saveDb();
  }
};

module.exports = { getDb, Shop, ShopSettings, Job, ApiKey };
