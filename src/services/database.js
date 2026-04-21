/**
 * Database layer using Prisma (PostgreSQL)
 * Provides the same API interface as the old sql.js layer
 * so all routes/services continue to work without changes.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

// ─── SHOP ──────────────────────────────────────────

const Shop = {
  async findUnique(shopDomain) {
    return prisma.shop.findUnique({ where: { shopDomain } });
  },

  async findById(id) {
    return prisma.shop.findUnique({ where: { id } });
  },

  async findFirst() {
    return prisma.shop.findFirst();
  },

  async upsert(shopDomain, data) {
    return prisma.shop.upsert({
      where: { shopDomain },
      update: {
        accessToken: data.accessToken,
        scopes: data.scopes || undefined,
      },
      create: {
        shopDomain,
        accessToken: data.accessToken,
        scopes: data.scopes || '',
      },
    });
  },

  async update(id, data) {
    return prisma.shop.update({ where: { id }, data });
  },

  async delete(id) {
    return prisma.shop.delete({ where: { id } });
  },

  async withSettings(shopDomain) {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      include: { settings: true },
    });
    return shop;
  },
};

// ─── SHOP SETTINGS ─────────────────────────────────

const ShopSettings = {
  async findByShopId(shopId) {
    return prisma.shopSettings.findUnique({ where: { shopId } });
  },

  async upsert(shopId, data) {
    return prisma.shopSettings.upsert({
      where: { shopId },
      update: {
        allowExternalDownload: data.allowExternalDownload ?? false,
        notifyOnComplete: data.notifyOnComplete ?? true,
        notifyEmail: data.notifyEmail || null,
        defaultBlogHandle: data.defaultBlogHandle || 'news',
      },
      create: {
        shopId,
        allowExternalDownload: data.allowExternalDownload ?? false,
        notifyOnComplete: data.notifyOnComplete ?? true,
        notifyEmail: data.notifyEmail || null,
        defaultBlogHandle: data.defaultBlogHandle || 'news',
      },
    });
  },

  async deleteByShopId(shopId) {
    return prisma.shopSettings.deleteMany({ where: { shopId } });
  },
};

// ─── JOB ───────────────────────────────────────────

const Job = {
  async create(data) {
    return prisma.job.create({
      data: {
        shopId: data.shopId,
        type: data.type,
        resourceType: data.resourceType,
        status: data.status || 'pending',
        fileName: data.fileName || null,
        filePath: data.filePath || null,
        triggeredBy: data.triggeredBy || 'manual',
      },
    });
  },

  async findById(id) {
    return prisma.job.findUnique({ where: { id } });
  },

  async findMany({ shopId, status, orderBy, skip, take, filter } = {}) {
    const where = {};
    if (shopId) where.shopId = shopId;
    if (status) where.status = status;
    if (filter) {
      where.OR = [
        { fileName: { contains: filter, mode: 'insensitive' } },
        { id: { contains: filter, mode: 'insensitive' } },
      ];
    }

    return prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: skip || undefined,
      take: take || undefined,
    });
  },

  async count({ shopId, status, filter } = {}) {
    const where = {};
    if (shopId) where.shopId = shopId;
    if (status) where.status = status;
    if (filter) {
      where.OR = [
        { fileName: { contains: filter, mode: 'insensitive' } },
        { id: { contains: filter, mode: 'insensitive' } },
      ];
    }

    return prisma.job.count({ where });
  },

  async update(id, data) {
    // Convert string dates to Date objects for Prisma
    const updateData = { ...data };
    if (updateData.startedAt && typeof updateData.startedAt === 'string') {
      updateData.startedAt = new Date(updateData.startedAt);
    }
    if (updateData.completedAt && typeof updateData.completedAt === 'string') {
      updateData.completedAt = new Date(updateData.completedAt);
    }
    return prisma.job.update({ where: { id }, data: updateData });
  },

  async deleteByShopId(shopId) {
    return prisma.job.deleteMany({ where: { shopId } });
  },

  /**
   * Find the next pending/queued job for a shop (or globally)
   */
  async findNextPending(shopId = null) {
    const where = { status: { in: ['pending', 'queued'] } };
    if (shopId) where.shopId = shopId;
    return prisma.job.findFirst({
      where,
      orderBy: { createdAt: 'asc' },
      include: { shop: true },
    });
  },
};

// ─── API KEY ───────────────────────────────────────

const ApiKey = {
  async create(data) {
    return prisma.apiKey.create({
      data: {
        shopId: data.shopId,
        name: data.name,
        key: data.key,
      },
    });
  },

  async findById(id) {
    return prisma.apiKey.findUnique({ where: { id } });
  },

  async findByKey(key) {
    const result = await prisma.apiKey.findUnique({
      where: { key },
      include: {
        shop: {
          include: { settings: true },
        },
      },
    });
    return result;
  },

  async findByShopId(shopId) {
    return prisma.apiKey.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async update(id, data) {
    // Convert string dates
    const updateData = { ...data };
    if (updateData.lastUsedAt && typeof updateData.lastUsedAt === 'string') {
      updateData.lastUsedAt = new Date(updateData.lastUsedAt);
    }
    return prisma.apiKey.update({ where: { id }, data: updateData });
  },

  async delete(id) {
    return prisma.apiKey.delete({ where: { id } });
  },

  async deleteByShopId(shopId) {
    return prisma.apiKey.deleteMany({ where: { shopId } });
  },
};

// ─── SESSION (for embedded app) ───────────────────

const SessionStore = {
  async store(session) {
    return prisma.session.upsert({
      where: { id: session.id },
      update: {
        shopId: session.shopId,
        state: session.state || null,
        isOnline: session.isOnline || false,
        accessToken: session.accessToken || null,
        expires: session.expires ? new Date(session.expires) : null,
      },
      create: {
        id: session.id,
        shopId: session.shopId,
        state: session.state || null,
        isOnline: session.isOnline || false,
        accessToken: session.accessToken || null,
        expires: session.expires ? new Date(session.expires) : null,
      },
    });
  },

  async load(id) {
    return prisma.session.findUnique({ where: { id } });
  },

  async delete(id) {
    return prisma.session.delete({ where: { id } }).catch(() => null);
  },

  async deleteByShopId(shopId) {
    return prisma.session.deleteMany({ where: { shopId } });
  },
};

module.exports = { prisma, Shop, ShopSettings, Job, ApiKey, SessionStore };
