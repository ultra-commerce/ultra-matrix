# Ultra Matrix v2.0 - Setup & Deployment Guide

## Architecture

- **Backend**: Express.js (Node.js 18+)
- **Database**: PostgreSQL (via Prisma ORM)
- **Job Queue**: BullMQ + Redis (sequential processing, 1 at a time)
- **Hosting**: Railway.app
- **Auth**: Shopify OAuth 2.0 + Session Tokens (embedded app)

## Local Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `SHOPIFY_API_KEY` — From Shopify Partners dashboard
- `SHOPIFY_API_SECRET` — From Shopify Partners dashboard
- `DATABASE_URL` — PostgreSQL connection string (e.g., `postgresql://user:pass@localhost:5432/ultra_matrix`)
- `REDIS_HOST` / `REDIS_PORT` — Redis connection (default: localhost:6379)
- `ULTRA_MATRIX_API_KEY` — Any random string for agent API access

### 3. Set Up Database

```bash
# Push schema to your database (creates all tables)
npx prisma db push

# Generate Prisma client
npx prisma generate
```

### 4. Start Redis

```bash
# macOS with Homebrew
brew install redis && brew services start redis

# Or via Docker
docker run -d -p 6379:6379 redis
```

### 5. Start Development Server

```bash
# With Shopify CLI (recommended — handles tunneling & OAuth)
shopify app dev

# Or standalone
npm run dev
```

## Railway Deployment

### 1. Provision Services

In your Railway project, add these three services:

1. **PostgreSQL** — Railway plugin (auto-provisions)
2. **Redis** — Railway plugin (auto-provisions)
3. **Node.js service** — Your Ultra Matrix app code

### 2. Environment Variables

Railway auto-provides `DATABASE_URL` for PostgreSQL. Set these manually:

```
SHOPIFY_API_KEY=8f1681559f943fe4e3619d99a8b206c3
SHOPIFY_API_SECRET=<your_secret_from_partners_dashboard>
HOST=https://ultra-matrix-production.up.railway.app
ULTRA_MATRIX_API_KEY=<generate_a_random_key>
NODE_ENV=production
REDIS_HOST=<from_railway_redis_plugin>
REDIS_PORT=<from_railway_redis_plugin>
REDIS_PASSWORD=<from_railway_redis_plugin>
```

### 3. Deploy

Railway auto-deploys on push. The `postinstall` script runs `prisma generate`.

For first deploy, run the database migration:
```bash
npx prisma db push
```

## Using Ultra Matrix

### Import via Dashboard
1. Open the app in your Shopify admin
2. Select resource type (Products, Blog Posts, Pages, etc.)
3. Upload a Matrixify-compatible CSV file
4. Jobs queue and process one at a time — watch progress on the Jobs page

### Export via Dashboard
1. Go to All Jobs or the Dashboard
2. Select resource type and click "Export to CSV"
3. Once completed, download the Matrixify-compatible CSV

### Import via API (for Claude Cowork / agents)

```bash
curl -X POST https://YOUR-URL/api/v1/import \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{"Title": "My Post", "Body HTML": "<p>Hello</p>", "Blog: Handle": "news"}],
    "resource_type": "blog_posts"
  }'
```

### Supported Resource Types

| Resource | Import | Export |
|----------|--------|--------|
| Products | ✅ | ✅ |
| Blog Posts | ✅ | ✅ |
| Pages | ✅ | ✅ |
| Customers | ✅ | ✅ |
| Orders | ✅ (tags/notes only) | ✅ |
| Redirects | ✅ | ✅ |
| Custom Collections | ✅ | ✅ |
| Smart Collections | ✅ | ✅ |

## Shopify App Store Submission Checklist

- [x] Embedded app (iframe in Shopify Admin)
- [x] GDPR webhooks (customer data request, customer redact, shop redact)
- [x] App uninstall webhook with data cleanup
- [x] Shopify Billing API for recurring charges
- [x] Content Security Policy headers
- [x] Session token authentication
- [x] Rate limiting on Shopify API calls
- [x] Health check endpoint (/health)
- [ ] Privacy Policy page (create at your domain)
- [ ] Terms of Service page (create at your domain)
- [ ] App listing screenshots
- [ ] App description and keywords
- [ ] Testing on a development store
- [ ] Submit for review

## Troubleshooting

**"Cannot connect to Redis"** — Make sure Redis is running. Jobs will be created but won't process without Redis.

**"Prisma not found"** — Run `npm install` and `npx prisma generate`.

**"HMAC verification failed"** — Make sure `SHOPIFY_API_SECRET` matches your Shopify Partners dashboard.

**Plan buttons don't redirect** — The billing flow requires the app to be accessed through Shopify Admin (embedded). Direct URL access won't work for charge confirmation.
