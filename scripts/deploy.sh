#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export PATH="/home/warren/.nvm/versions/node/v24.11.1/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "============================================================"
echo "[*] TACTICAL MONITOR: STARTING DEPLOYMENT CYCLE"
echo "============================================================"

cd "$PROJECT_DIR"

# 1. Execute Daily Ingest & Delta Audit
echo "[*] Phase 1: Running Advisory Ingest and Delta Computation..."
python3 scripts/daily_sync.py

# 2. Deploy to Cloudflare Workers
echo "[*] Phase 2: Deploying Worker & Assets to Cloudflare..."
if [ -f "$PROJECT_DIR/.env" ]; then
  # shellcheck source=/dev/null
  source "$PROJECT_DIR/.env"
fi

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-d7617dbd740f2c120f3a3a4a81086fbd}"
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-cfut_UNWB0NKVThiVeJEof9snnKDgMCAPBVNbBTmE1bgxbf252a84}"

npx wrangler deploy

# 3. Verify Live Endpoint
echo "[*] Phase 3: Verifying Live Custom Domain (travel-advisories.hyltons.us)..."
sleep 2

STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --doh-url https://cloudflare-dns.com/dns-query https://travel-advisories.hyltons.us || echo "000")
echo "[+] Endpoint Response Code: $STATUS_CODE"

echo "============================================================"
echo "[+] DEPLOYMENT COMPLETE: https://travel-advisories.hyltons.us"
echo "============================================================"
