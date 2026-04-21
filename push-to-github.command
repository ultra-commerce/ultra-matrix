#!/bin/bash
# Push Ultra Matrix v2 to GitHub (with token auth)
cd "$(dirname "$0")"
echo "==============================="
echo "Ultra Matrix - Push to GitHub"
echo "==============================="
echo ""
echo "Working directory: $(pwd)"
echo ""

# Step 1: Remove stale lock files
echo "[1/4] Removing stale git lock files..."
rm -f .git/index.lock .git/HEAD.lock
echo "Done."
echo ""

# Step 2: Stage all changes
echo "[2/4] Staging all changes..."
git add -A
echo "Done. Staged files:"
git status --short
echo ""

# Step 3: Commit
echo "[3/4] Committing Ultra Matrix v2.0..."
git commit -m "Ultra Matrix v2.0 - SaaS Shopify App

- Migrated to PostgreSQL with Prisma ORM
- Added BullMQ + Redis persistent job queue
- Converted to embedded Shopify app with App Bridge
- Added export functionality (products, orders, customers, pages, blogs)
- Added Shopify Billing API with subscription plans
- App Store ready with proper scopes, webhooks, and GDPR compliance"
echo ""

# Step 4: Push using token auth
echo "[4/4] Pushing to GitHub..."
git remote set-url origin https://x-access-token:ghp_MfAH0n8Yzqdm9809D0PVFbiRcCR2mX4c5EYN@github.com/ultra-commerce/ultra-matrix.git
git branch -M main
git push -u origin main --force
echo ""

# Clean up: remove token from remote URL after push
git remote set-url origin https://github.com/ultra-commerce/ultra-matrix.git

echo "==============================="
echo "Done! Check https://github.com/ultra-commerce/ultra-matrix"
echo "==============================="
echo ""
echo "Press any key to close this window..."
read -n 1
