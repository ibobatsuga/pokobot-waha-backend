const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const API_KEY = (process.env.WAHA_API_KEY || "").trim();
const INTERNAL_KEY = API_KEY || "pokobot_internal_waha";
const BASE_WEBHOOK_URL = (
  process.env.WHATSAPP_HOOK_URL || "https://ping-clone-poc.vercel.app/api/webhook"
).trim();
const DATA_DIR = process.env.DATA_DIR || "/opt/pokobot-waha";
const REGISTRY_FILE = path.join(DATA_DIR, "registry.json");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const WAHA_IMAGE = process.env.WAHA_IMAGE || "devlikeapro/waha:latest";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function readRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return {};
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeRegistry(reg) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
}

function sanitizeSessionName(raw) {
  const cleaned = String(raw || "default")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return cleaned || `wa-${Date.now()}`;
}

function allocatePort(registry) {
  const used = new Set(Object.values(registry).map((item) => item.port));
  for (let p = 3101; p <= 3999; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("Maximum session port capacity reached");
}

function runDocker(args) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      resolve(stdout.trim());
    });
  });
}

async function ensureContainer(sessionId, label, webhookUrl, owner = "") {
  const reg = readRegistry();
  const safeId = sanitizeSessionName(sessionId);
  const cleanOwner = String(owner || "").trim().toLowerCase();
  let entry = reg[safeId];

  if (!entry) {
    const port = allocatePort(reg);
    entry = {
      name: safeId,
      label: label || safeId,
      owner: cleanOwner,
      port,
      createdAt: new Date().toISOString(),
    };
    reg[safeId] = entry;
    writeRegistry(reg);
  } else {
    let changed = false;
    if (label && entry.label !== label) {
      entry.label = label;
      changed = true;
    }
    if (cleanOwner && !entry.owner) {
      entry.owner = cleanOwner;
      changed = true;
    }
    if (changed) {
      reg[safeId] = entry;
      writeRegistry(reg);
    }
  }

  const containerName = `pokobot_waha_${safeId}`;
  const sessionVol = path.join(SESSIONS_DIR, safeId);
  fs.mkdirSync(sessionVol, { recursive: true });

  // Check if container exists
  let exists = false;
  let running = false;
  try {
    const inspect = await runDocker(["inspect", "-f", "{{.State.Running}}", containerName]);
    exists = true;
    running = inspect === "true";
  } catch {
    exists = false;
  }

  if (!exists) {
    const hookTarget = webhookUrl || BASE_WEBHOOK_URL;
    const sep = hookTarget.includes("?") ? "&" : "?";
    const scopedHook = `${hookTarget}${sep}device=${encodeURIComponent(safeId)}&label=${encodeURIComponent(entry.label)}&owner=${encodeURIComponent(entry.owner || "")}`;

    await runDocker([
      "run",
      "-d",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
      "-p",
      `127.0.0.1:${entry.port}:3000`,
      "-v",
      `${sessionVol}:/app/.sessions`,
      "-e",
      "WHATSAPP_API_HOSTNAME=0.0.0.0",
      "-e",
      "WHATSAPP_API_PORT=3000",
      "-e",
      "WHATSAPP_DEFAULT_ENGINE=NOWEB",
      "-e",
      `WAHA_API_KEY=${INTERNAL_KEY}`,
      "-e",
      "WAHA_PRINT_QR=false",
      "-e",
      "WHATSAPP_START_SESSION=default",
      "-e",
      "WHATSAPP_RESTART_ALL_SESSIONS=True",
      "-e",
      `WHATSAPP_HOOK_URL=${scopedHook}`,
      "-e",
      "WHATSAPP_HOOK_EVENTS=message,session.status",
      WAHA_IMAGE,
    ]);
  } else if (!running) {
    await runDocker(["start", containerName]);
  }

  return entry;
}

function proxyRequest(port, targetPath, method = "GET", bodyBuffer = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: targetPath,
        method,
        timeout: 10000,
        headers: {
          "X-Api-Key": INTERNAL_KEY,
          ...extraHeaders,
          ...(bodyBuffer ? { "Content-Length": bodyBuffer.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 200,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Container timeout"));
    });
    req.on("error", reject);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

async function getSessionDetails(entry) {
  try {
    const res = await proxyRequest(entry.port, "/api/sessions/default", "GET");
    if (res.status >= 200 && res.status < 300) {
      const parsed = JSON.parse(res.body.toString("utf8"));
      return {
        name: entry.name,
        label: entry.label || entry.name,
        owner: entry.owner || null,
        status: parsed.status || "STARTING",
        me: parsed.me || null,
        createdAt: entry.createdAt,
      };
    }
  } catch {
    // Container might still be booting
  }
  return {
    name: entry.name,
    label: entry.label || entry.name,
    owner: entry.owner || null,
    status: "STARTING",
    me: null,
    createdAt: entry.createdAt,
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, Authorization",
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, Authorization",
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Health / Version endpoint (public)
  if (pathname === "/api/version" || pathname === "/health") {
    return sendJson(res, 200, {
      version: "2026.11-multi-waha",
      engine: "NOWEB",
      multiDevice: true,
      status: "ok",
    });
  }

  // Enforce X-Api-Key on all operational endpoints
  if (API_KEY) {
    const provided = req.headers["x-api-key"] || parsedUrl.searchParams.get("apiKey") || "";
    if (provided !== API_KEY) {
      return sendJson(res, 401, { error: "Unauthorized: Invalid X-Api-Key" });
    }
  }

  const ownerFilter = String(
    req.headers["x-owner-email"] || parsedUrl.searchParams.get("owner") || ""
  )
    .trim()
    .toLowerCase();

  const isAllowedOwner = (entry) => {
    if (!ownerFilter) return true;
    return (entry?.owner || "").toLowerCase() === ownerFilter;
  };

  try {
    // 1. LIST SESSIONS (Strictly scoped by owner when ?owner= or X-Owner-Email is provided)
    if (pathname === "/api/sessions" && req.method === "GET") {
      const reg = readRegistry();
      const entries = Object.values(reg).filter((entry) => isAllowedOwner(entry));
      const list = await Promise.all(entries.map((entry) => getSessionDetails(entry)));
      return sendJson(res, 200, list);
    }

    // 2. CREATE / START SESSION WITH LABEL & OWNER
    if (pathname === "/api/sessions" && req.method === "POST") {
      const rawBody = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(rawBody.toString("utf8") || "{}");
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON" });
      }

      const safeId = sanitizeSessionName(body.name || `wa-${Date.now()}`);
      const label = String(body.label || body.name || "WhatsApp Baru").trim();
      const owner = String(body.owner || ownerFilter || "").trim().toLowerCase();
      const webhookUrl = body?.config?.webhooks?.[0]?.url || BASE_WEBHOOK_URL;

      const reg = readRegistry();
      if (reg[safeId] && owner && (reg[safeId].owner || "").toLowerCase() && (reg[safeId].owner || "").toLowerCase() !== owner) {
        return sendJson(res, 403, { error: "Session belongs to another user" });
      }

      const entry = await ensureContainer(safeId, label, webhookUrl, owner);

      // Give freshly spawned container a moment to bind if needed
      let details = await getSessionDetails(entry);
      if (details.status === "STOPPED") {
        await proxyRequest(entry.port, "/api/sessions/default/start", "POST").catch(() => {});
        details = await getSessionDetails(entry);
      }
      return sendJson(res, 201, details);
    }

    // 3. SINGLE SESSION DETAILS
    const sessionDetailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionDetailMatch && req.method === "GET") {
      const safeId = sanitizeSessionName(decodeURIComponent(sessionDetailMatch[1]));
      const reg = readRegistry();
      const entry = reg[safeId];
      if (!entry) {
        return sendJson(res, 404, { error: "Session not found" });
      }
      if (!isAllowedOwner(entry)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      const details = await getSessionDetails(entry);
      return sendJson(res, 200, details);
    }

    // 4. DELETE / REMOVE SESSION PERMANENTLY
    if (sessionDetailMatch && req.method === "DELETE") {
      const safeId = sanitizeSessionName(decodeURIComponent(sessionDetailMatch[1]));
      const reg = readRegistry();
      const entry = reg[safeId];
      if (entry && !isAllowedOwner(entry)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      const containerName = `pokobot_waha_${safeId}`;
      await runDocker(["rm", "-f", containerName]).catch(() => {});
      fs.rmSync(path.join(SESSIONS_DIR, safeId), { recursive: true, force: true });
      delete reg[safeId];
      writeRegistry(reg);
      return sendJson(res, 200, { ok: true, deleted: safeId });
    }

    // 5. START OR LOGOUT SESSION
    const sessionActionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/(start|stop|logout)$/);
    if (sessionActionMatch && req.method === "POST") {
      const safeId = sanitizeSessionName(decodeURIComponent(sessionActionMatch[1]));
      const action = sessionActionMatch[2];
      const reg = readRegistry();
      const entry = reg[safeId];

      if (!entry) {
        return sendJson(res, 404, { error: "Session not found" });
      }
      if (!isAllowedOwner(entry)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }

      if (action === "logout" || action === "stop") {
        await proxyRequest(entry.port, `/api/sessions/default/${action}`, "POST").catch(() => {});
        if (action === "logout") {
          const containerName = `pokobot_waha_${safeId}`;
          await runDocker(["rm", "-f", containerName]).catch(() => {});
          fs.rmSync(path.join(SESSIONS_DIR, safeId), { recursive: true, force: true });
          delete reg[safeId];
          writeRegistry(reg);
        }
        return sendJson(res, 200, { ok: true, status: "STOPPED" });
      }

      await ensureContainer(safeId, entry.label, undefined, entry.owner);
      const startRes = await proxyRequest(entry.port, "/api/sessions/default/start", "POST").catch(() => null);
      return sendJson(res, 200, { ok: true, upstream: startRes ? startRes.status : 202 });
    }

    // 6. FETCH LIVE QR CODE FOR SESSION
    const qrMatch = pathname.match(/^\/api\/([^/]+)\/auth\/qr$/);
    if (qrMatch && req.method === "GET") {
      const safeId = sanitizeSessionName(decodeURIComponent(qrMatch[1]));
      const reg = readRegistry();
      if (reg[safeId] && !isAllowedOwner(reg[safeId])) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      const label = parsedUrl.searchParams.get("label") || safeId;
      const entry = reg[safeId] || (await ensureContainer(safeId, label, undefined, ownerFilter));

      try {
        const format = parsedUrl.searchParams.get("format") || "image";
        const qrRes = await proxyRequest(
          entry.port,
          `/api/default/auth/qr?format=${encodeURIComponent(format)}`,
          "GET"
        );
        res.writeHead(qrRes.status, {
          "Content-Type": qrRes.headers["content-type"] || "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(qrRes.body);
      } catch {
        return sendJson(res, 202, { status: "STARTING", message: "WAHA container is booting" });
      }
    }

    // 7. SEND TEXT MESSAGE THROUGH SPECIFIC SESSION (no cross-tenant fallback)
    if (pathname === "/api/sendText" && req.method === "POST") {
      const rawBody = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(rawBody.toString("utf8") || "{}");
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON" });
      }

      const reg = readRegistry();
      const requested = sanitizeSessionName(body.session || "default");
      const entry = reg[requested];

      if (!entry) {
        return sendJson(res, 404, { error: "Perangkat WhatsApp untuk sesi ini belum terhubung" });
      }
      if (!isAllowedOwner(entry)) {
        return sendJson(res, 403, { error: "Forbidden: session belongs to another user" });
      }

      const forwardBody = Buffer.from(
        JSON.stringify({
          ...body,
          session: "default",
        })
      );

      const upstream = await proxyRequest(entry.port, "/api/sendText", "POST", forwardBody, {
        "Content-Type": "application/json",
      });
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers["content-type"] || "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(upstream.body);
    }

    return sendJson(res, 404, { error: `Route ${pathname} not found on PokoBot Multi-WAHA Orchestrator` });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || "Internal orchestrator error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[PokoBot Multi-WAHA Orchestrator] listening on 0.0.0.0:${PORT}`);
});
