# PokoBot Cloud WAHA Backend

Backend gateway **WAHA (WhatsApp HTTP API)** siap pakai untuk dihubungkan dengan **[PokoBot CRM & AI SaaS](https://ping-clone-poc.vercel.app)**.

Dirancang khusus untuk **Cloud / VPS Production** (tanpa `localhost`):
- Menggunakan engine **`NOWEB`** (berbasis WebSocket langsung, hemat RAM ~120MB, stabil di Railway/Render/Fly.io/VPS kecil tanpa Chromium).
- Pre-configured webhook global ke PokoBot (`/api/webhook`).
- Support volume persisten (`/app/.sessions`) agar login WhatsApp tidak hilang saat container restart.
- Dilengkapi konfigurasi native untuk **Railway**, **Render**, **Fly.io**, dan **Docker Compose / Coolify**.

---

## Opsi Deploy Cepat

### 1. Deploy di Railway (Direkomendasikan)
1. Buka [Railway](https://railway.app) &rarr; **New Project** &rarr; **Deploy from GitHub repo** &rarr; pilih repo **`pokobot-waha-backend`**.
2. Di menu **Variables**, tambahkan:
   - `WAHA_API_KEY` = `isi_dengan_password_rahasia_anda`
   - `WHATSAPP_HOOK_URL` = `https://ping-clone-poc.vercel.app/api/webhook`
   - `WHATSAPP_DEFAULT_ENGINE` = `NOWEB`
3. Di menu **Settings &rarr; Networking**, klik **Generate Domain** (misal: `https://pokobot-waha.up.railway.app`).
4. Tambahkan **Volume** ke mount path `/app/.sessions` agar sesi WhatsApp tersimpan permanen.

### 2. Deploy di VPS Ubuntu / Hostinger / Coolify
```bash
git clone https://github.com/ibobatsuga/pokobot-waha-backend.git
cd pokobot-waha-backend
cp .env.example .env
# Edit .env dan isi WAHA_API_KEY
docker compose up -d
```
Lalu arahkan domain/reverse proxy HTTPS (Nginx / Caddy / Cloudflare Tunnel) ke port `3000`.

### 3. Deploy di Render / Fly.io
- **Render:** Klik **New Blueprint** dan arahkan ke repository ini (`render.yaml` sudah tersedia).
- **Fly.io:** Jalankan `fly launch --copy-config` (`fly.toml` sudah tersedia).

---

## Cara Menghubungkan ke Aplikasi PokoBot

1. Buka aplikasi PokoBot di `https://ping-clone-poc.vercel.app/app/device` (atau klik **Hubungkan WhatsApp** di Dashboard / Sidebar).
2. Masukkan **Cloud WAHA Base URL** Anda (contoh: `https://pokobot-waha.up.railway.app`) dan **WAHA API Key**.
3. Klik **Simpan & Muat QR Code**.
4. QR Code live langsung tampil di halaman maupun di Pop-up Modal — scan menggunakan **WhatsApp &rarr; Perangkat Tertaut** di HP Anda.
5. (Opsional untuk SaaS Multi-User otomatis): Set environment variable `WAHA_BASE_URL` dan `WAHA_API_KEY` di project **Vercel PokoBot**, sehingga semua user langsung bisa scan QR tanpa perlu mengisi URL server secara manual.
