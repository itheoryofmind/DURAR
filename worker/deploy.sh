#!/usr/bin/env bash
# deploys the reminder before the adhan to Cloudflare; run by the deploy workflow with the account's token
set -euo pipefail
cd "$(dirname "$0")"
: "${CLOUDFLARE_API_TOKEN:?the CLOUDFLARE_API_TOKEN secret is needed}"
api(){ curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }
ACC="${CLOUDFLARE_ACCOUNT_ID:-}"
[ -n "$ACC" ] || ACC=$(api https://api.cloudflare.com/client/v4/accounts | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"][0]["id"])')
NS=$(api "https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces?per_page=100" | python3 -c 'import sys,json;r=[n["id"] for n in json.load(sys.stdin)["result"] if n["title"]=="durar-push"];print(r[0] if r else "")')
if [ -z "$NS" ]; then
  NS=$(api -X POST "https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces" -d '{"title":"durar-push"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["id"])')
  echo "store created"
fi
# on the site's own domain when it is in this account; otherwise on the account's workers.dev address
ZONE=$(api "https://api.cloudflare.com/client/v4/zones?name=dorarnajdiah.com" | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r[0]["id"] if r else "")' || true)
if [ -n "$ZONE" ]; then
  ROUTE='workers_dev = false
routes = [{ pattern = "push.dorarnajdiah.com", custom_domain = true }]'
  URL="https://push.dorarnajdiah.com"
else
  SUB=$(api "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/subdomain" | python3 -c 'import sys,json;print((json.load(sys.stdin).get("result") or {}).get("subdomain") or "")' || true)
  ROUTE='workers_dev = true'
  URL="https://durar-push.$SUB.workers.dev"
fi
cat > wrangler.toml <<T
name = "durar-push"
main = "src/index.js"
compatibility_date = "2024-09-01"
account_id = "$ACC"
$ROUTE
[[kv_namespaces]]
binding = "PUSH"
id = "$NS"
[[services]]
binding = "SELF"
service = "durar-push"
[triggers]
crons = ["*/3 * * * *"]   # every three minutes: the readers whose adhan is about ten minutes away
T
CLOUDFLARE_ACCOUNT_ID="$ACC" npx --yes wrangler@3 deploy
ADMIN=$(printf %s "durar:$CLOUDFLARE_API_TOKEN" | sha256sum | cut -c1-40)
api -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces/$NS/values/admin" --data-binary "$ADMIN" -H "Content-Type: text/plain" >/dev/null && echo "test key set"
echo "$URL" > "${URL_OUT:-/dev/null}"
for i in $(seq 1 30); do
  if out=$(curl -fsS "$URL/health" 2>/dev/null); then echo "live: $out"; exit 0; fi
  sleep 10
done
echo "deployed, but $URL did not answer yet"; exit 1
