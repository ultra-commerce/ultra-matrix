# Ultra Matrix - Setup Guide

Your app is already created in the Shopify Dev Dashboard. Here's how to run it.

## Step 1: Install Shopify CLI

Open **Terminal** on your Mac (search "Terminal" in Spotlight) and paste:

```
npm install -g @shopify/cli@latest
```

Wait for it to finish (takes about 1 minute).

## Step 2: Navigate to the app folder

In Terminal, navigate to wherever this folder is on your Mac. For example:

```
cd "/Users/drew/Ultra Matrix Shopify App"
```

(Adjust the path to match where the folder actually is on your computer.)

## Step 3: Install dependencies

```
npm install
```

## Step 4: Start the app

```
shopify app dev
```

The CLI will:
- Ask you to log in to your Partner account (first time only — opens your browser)
- Ask which dev store to use — pick your test store
- Create a secure tunnel automatically (no ngrok needed)
- Configure all URLs and OAuth for you
- Start the Ultra Matrix server

Once running, press **p** to open the app in your browser.

That's it — you're done!

---

## Using Ultra Matrix

### Import via Dashboard
1. Open the app (press `p` in Terminal while `shopify app dev` is running)
2. Select "Blog Posts" as the resource type
3. Upload a CSV file (see the `samples/` folder for examples)
4. Watch job progress on the All Jobs page

### Import via API (for Claude Cowork / OpenClaw agents)

Your API key is: `um_ultra_matrix_dev_key_2026` (set in `.env`)

```bash
# Import blog posts
curl -X POST https://YOUR-TUNNEL-URL/api/v1/import \
  -H "Authorization: Bearer um_ultra_matrix_dev_key_2026" \
  -H "Content-Type: application/json" \
  -d '{
    "records": [
      {
        "Title": "My Blog Post",
        "Body HTML": "<p>Hello world!</p>",
        "Blog: Handle": "news",
        "Tags": "test, example",
        "Published": "true"
      }
    ],
    "resource_type": "blog_posts"
  }'

# Check job status
curl https://YOUR-TUNNEL-URL/api/v1/jobs \
  -H "Authorization: Bearer um_ultra_matrix_dev_key_2026"
```

Replace `YOUR-TUNNEL-URL` with the Cloudflare tunnel URL shown in Terminal after running `shopify app dev`.

### CSV Format

Ultra Matrix uses Matrixify-compatible CSV. Example files are in the `samples/` folder:
- `samples/blog-posts-sample.csv` — Blog posts with SEO fields
- `samples/pages-sample.csv` — Shopify pages

---

## Troubleshooting

**"shopify: command not found"**
→ Run `npm install -g @shopify/cli@latest` again

**"Not logged in"**
→ Run `shopify auth login` and follow the browser prompt

**"Port already in use"**
→ Shopify CLI picks a free port automatically, so this shouldn't happen

**App shows "Install" page**
→ This is normal on first run. Click Install to authorize the app on your dev store.
