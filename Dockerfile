# PokoBot Cloud WAHA Backend (WhatsApp HTTP API)
# Optimized for Railway, Render, Fly.io, Coolify, and Cloud VPS

FROM devlikeapro/waha:latest

# Default Cloud-optimized Environment Variables (Override via Cloud Platform Dashboard)
ENV WHATSAPP_API_HOSTNAME=0.0.0.0 \
    WHATSAPP_API_PORT=3000 \
    WHATSAPP_DEFAULT_ENGINE=NOWEB \
    WAHA_PRINT_QR=false \
    WAHA_SWAGGER_ENABLED=true \
    WHATSAPP_START_SESSION=default \
    WHATSAPP_RESTART_ALL_SESSIONS=True \
    WHATSAPP_HOOK_URL=https://ping-clone-poc.vercel.app/api/webhook \
    WHATSAPP_HOOK_EVENTS=message,session.status

# Persistent session storage directory (mount Cloud Volume here)
VOLUME ["/app/.sessions"]

EXPOSE 3000
