#!/usr/bin/env bash
set -euo pipefail

# PokoBot Multi-WhatsApp WAHA Cloud Installer (Ubuntu 22.04 / 24.04)
# Usage: bash setup-vps.sh [WAHA_API_KEY] [PUBLIC_DOMAIN]

VPS_IP=$(curl -s4 ifconfig.me || echo "217.216.146.181")
DASH_IP="${VPS_IP//./-}"
DOMAIN="${2:-${DASH_IP}.sslip.io}"
API_KEY="${1:-pk_waha_$(openssl rand -hex 16)}"
WEBHOOK_URL="${WHATSAPP_HOOK_URL:-https://ping-clone-poc.vercel.app/api/webhook}"

echo "=================================================="
echo " Installing PokoBot Multi-WAHA Cloud Orchestrator"
echo " Domain  : https://${DOMAIN}"
echo " Webhook : ${WEBHOOK_URL}"
echo "=================================================="

# 1. Clean up any legacy containers on port 3000
if command -v docker >/dev/null 2>&1; then
  docker ps -aq --filter "name=pokobot_waha_" | xargs -r docker rm -f || true
fi

# 2. Install base packages, Docker, Node.js 20, Caddy
apt-get update -y
apt-get install -y curl ca-certificates gnupg openssl ufw

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

# 3. Pull latest WAHA NOWEB image
docker pull devlikeapro/waha:latest

# 4. Install orchestrator
mkdir -p /opt/pokobot-waha/sessions
cp -f "$(dirname "$0")/orchestrator/server.js" /opt/pokobot-waha/server.js

cat > /etc/systemd/system/pokobot-waha.service <<EOF
[Unit]
Description=PokoBot Multi-WAHA Cloud Orchestrator
After=docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/pokobot-waha
Environment=PORT=3000
Environment=WAHA_API_KEY=${API_KEY}
Environment=WHATSAPP_HOOK_URL=${WEBHOOK_URL}
Environment=DATA_DIR=/opt/pokobot-waha
ExecStart=/usr/bin/node /opt/pokobot-waha/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pokobot-waha

# 5. Configure Caddy Reverse Proxy with Auto-SSL
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:3000
}
EOF

systemctl reload caddy || systemctl restart caddy

# 6. Firewall
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
echo "y" | ufw enable || true

echo ""
echo "=================================================="
echo " INSTALLATION COMPLETE!"
echo " WAHA_BASE_URL = https://${DOMAIN}"
echo " WAHA_API_KEY  = ${API_KEY}"
echo "=================================================="
