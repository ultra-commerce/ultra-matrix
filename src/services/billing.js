/**
 * Billing Service
 * Handles Shopify recurring charges, plan management, and limit enforcement.
 */

const { Shop } = require('./database');
const ShopifyAPI = require('./shopifyApi');
const logger = require('../utils/logger');

// ─── Plan Definitions ──────────────────────────────

const PLANS = {
  free: {
    name: 'Demo',
    price: 0,
    limits: {
      products: 10,
      smart_collections: 10,
      custom_collections: 10,
      customers: 10,
      pages: 10,
      blog_posts: 10,
      redirects: 10,
      orders: 10,
    },
    features: [],
    trialDays: 0,
  },
  basic: {
    name: 'Basic',
    price: 20.0,
    limits: {
      products: 5000,
      smart_collections: 300,
      custom_collections: 300,
      customers: 2000,
      pages: 50,
      blog_posts: 50,
      redirects: 10000,
      orders: 1000,
    },
    features: ['metafields', 'scheduling'],
    trialDays: 7,
  },
  big: {
    name: 'Big',
    price: 50.0,
    limits: {
      products: 50000,
      smart_collections: 3000,
      custom_collections: 3000,
      customers: 20000,
      pages: 600,
      blog_posts: 500,
      redirects: 100000,
      orders: 10000,
    },
    features: ['metafields', 'scheduling', 'speed_5x'],
    trialDays: 7,
  },
  enterprise: {
    name: 'Enterprise',
    price: 200.0,
    limits: {
      products: Infinity,
      smart_collections: Infinity,
      custom_collections: Infinity,
      customers: Infinity,
      pages: Infinity,
      blog_posts: Infinity,
      redirects: Infinity,
      orders: Infinity,
    },
    features: ['metafields', 'scheduling', 'speed_max', 'priority_support'],
    trialDays: 7,
  },
};

/**
 * Get the plan definition for a plan name
 */
function getPlan(planName) {
  return PLANS[planName] || PLANS.free;
}

/**
 * Get the item limit for a resource type under a plan
 */
function getLimit(planName, resourceType) {
  const plan = getPlan(planName);
  return plan.limits[resourceType] || 10;
}

/**
 * Check if a shop's plan allows importing N items of a resource type
 */
function checkPlanLimit(planName, resourceType, itemCount) {
  const limit = getLimit(planName, resourceType);
  if (limit === Infinity) return { allowed: true, limit, remaining: Infinity };

  const remaining = Math.max(0, limit - itemCount);
  return {
    allowed: itemCount <= limit,
    limit,
    remaining,
    exceeded: itemCount > limit ? itemCount - limit : 0,
  };
}

/**
 * Get the rate delay for a plan (speed feature)
 */
function getImportDelay(planName) {
  const plan = getPlan(planName);
  if (plan.features.includes('speed_max')) return 50;   // 50ms = max speed
  if (plan.features.includes('speed_5x')) return 50;    // 50ms = 5x speed
  return 250; // Standard 250ms delay
}

/**
 * Create a Shopify recurring application charge for a plan
 * Returns the confirmation URL that the merchant must visit
 */
async function createCharge(shopDomain, accessToken, planName) {
  const plan = getPlan(planName);
  if (plan.price === 0) {
    // Free plan — no charge needed
    await Shop.update(
      (await Shop.findUnique(shopDomain)).id,
      { plan: 'free', chargeId: null, planExpiresAt: null }
    );
    return { url: null, free: true };
  }

  const shopify = new ShopifyAPI(shopDomain, accessToken);
  const host = process.env.HOST || process.env.SHOPIFY_APP_URL || 'https://ultra-matrix-production.up.railway.app';

  const charge = await shopify.createRecurringCharge({
    name: `Ultra Matrix - ${plan.name}`,
    price: plan.price,
    trial_days: plan.trialDays,
    return_url: `${host}/billing/callback?shop=${shopDomain}&plan=${planName}`,
    test: process.env.NODE_ENV !== 'production', // Test charges in dev
  });

  logger.info(`Created charge ${charge.id} for ${shopDomain} (${planName})`);

  return {
    url: charge.confirmation_url,
    chargeId: charge.id,
  };
}

/**
 * Handle the billing callback after merchant approves/declines
 */
async function handleBillingCallback(shopDomain, accessToken, chargeId, planName) {
  const shopify = new ShopifyAPI(shopDomain, accessToken);

  const charge = await shopify.getRecurringCharge(chargeId);

  if (charge.status === 'accepted') {
    // Activate the charge
    const activated = await shopify.activateRecurringCharge(chargeId);
    logger.info(`Activated charge ${chargeId} for ${shopDomain} (${planName})`);

    // Update shop record
    const shop = await Shop.findUnique(shopDomain);
    await Shop.update(shop.id, {
      plan: planName,
      chargeId: String(chargeId),
      planExpiresAt: null, // Recurring, no expiry
    });

    return { success: true, plan: planName, status: 'active' };
  } else if (charge.status === 'declined') {
    logger.info(`Charge ${chargeId} declined by ${shopDomain}`);
    return { success: false, status: 'declined' };
  } else {
    logger.warn(`Unexpected charge status ${charge.status} for ${chargeId}`);
    return { success: false, status: charge.status };
  }
}

/**
 * Cancel a shop's current subscription
 */
async function cancelSubscription(shopDomain, accessToken) {
  const shop = await Shop.findUnique(shopDomain);
  if (!shop || !shop.chargeId) return { success: true };

  try {
    const shopify = new ShopifyAPI(shopDomain, accessToken);
    await shopify.cancelRecurringCharge(shop.chargeId);
  } catch (err) {
    logger.error(`Failed to cancel charge ${shop.chargeId}:`, err.message);
  }

  await Shop.update(shop.id, {
    plan: 'free',
    chargeId: null,
    planExpiresAt: null,
  });

  return { success: true };
}

/**
 * Verify a shop's subscription is still active
 */
async function verifySubscription(shopDomain, accessToken) {
  const shop = await Shop.findUnique(shopDomain);
  if (!shop) return false;

  // Free plan always valid
  if (!shop.plan || shop.plan === 'free') return true;

  // Check with Shopify
  if (shop.chargeId) {
    try {
      const shopify = new ShopifyAPI(shopDomain, accessToken);
      const charge = await shopify.getRecurringCharge(shop.chargeId);

      if (charge.status === 'active') return true;

      // Charge is no longer active — downgrade to free
      logger.info(`Charge ${shop.chargeId} is ${charge.status}, downgrading ${shopDomain} to free`);
      await Shop.update(shop.id, { plan: 'free', chargeId: null });
      return false;
    } catch (err) {
      logger.error(`Failed to verify charge ${shop.chargeId}:`, err.message);
      return true; // Fail open — don't lock out on API errors
    }
  }

  return true;
}

module.exports = {
  PLANS,
  getPlan,
  getLimit,
  checkPlanLimit,
  getImportDelay,
  createCharge,
  handleBillingCallback,
  cancelSubscription,
  verifySubscription,
};
