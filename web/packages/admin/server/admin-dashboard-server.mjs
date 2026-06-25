import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(process.env.ADMIN_DASHBOARD_DIST_DIR ?? join(__dirname, "..", "dist"));
const basePath = normalizePrefix(process.env.ADMIN_DASHBOARD_BASE_PATH ?? "/admin-dashboard");
const apiPrefix = `${basePath}/api`;
const legacyAnalyticsPath = `${basePath}/legacy-analytics`;
const legacyAnalyticsRedirectPaths = new Set([
  "/analytics",
  "/analytics/",
  "/analytics-dashboard",
  "/analytics-dashboard/",
  "/legacy-analytics",
  "/legacy-analytics/",
  legacyAnalyticsPath,
  `${legacyAnalyticsPath}/`,
]);
const canonicalAnalyticsUrl = "https://nakama.intelli-verse-x.ai/analytics.html";
const port = Number(process.env.PORT ?? process.env.ADMIN_DASHBOARD_PORT ?? 8080);
const nakamaBaseUrl = stripTrailingSlash(process.env.NAKAMA_BASE_URL ?? "http://intelliverse-nakama:7350");
const nakamaHttpKey = process.env.NAKAMA_HTTP_KEY ?? "";
const consoleAuth = process.env.NAKAMA_CONSOLE_BASIC_AUTH
  ?? buildBasicAuth(process.env.NAKAMA_CONSOLE_USERNAME, process.env.NAKAMA_CONSOLE_PASSWORD);

// Live-event prize auto-fulfillment: the dashboard proxies the browser's
// "Approve" click to the Next.js fulfill endpoint, injecting the admin key
// server-side so it never reaches the browser. Defaults to the in-cluster
// Quizverse frontend service; override via env for other environments.
const liveEventsFulfillBaseUrl = stripTrailingSlash(
  process.env.LIVE_EVENTS_FULFILL_BASE_URL ?? "http://intelliverse-quiz-frontend.aicart.svc.cluster.local:3000",
);
const liveEventsAdminKey = process.env.LIVE_EVENTS_ADMIN_KEY ?? "";

// QuizVerse CRM metrics (WF-09) + growth snapshots (WF-32/33/40/41).
// Proxied here so tokens stay on the admin-dashboard pod — Nakama runtime
// RPCs still work when QUIZVERSE_* is set on intelliverse-nakama instead.
const quizverseN8nBaseUrl = stripTrailingSlash(
  process.env.QUIZVERSE_N8N_BASE_URL ?? "https://n8n.intelli-verse-x.ai",
);
const quizverseAdminApiToken =
  process.env.QUIZVERSE_ADMIN_API_TOKEN ?? process.env.ADMIN_API_TOKEN ?? "";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function normalizePrefix(value) {
  const prefixed = value.startsWith("/") ? value : `/${value}`;
  return prefixed.endsWith("/") ? prefixed.slice(0, -1) : prefixed;
}

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildBasicAuth(username, password) {
  if (!username || !password) return "";
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(text);
}

function sendText(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function isSafePath(base, candidate) {
  const rel = relative(base, candidate);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function getBearerToken(req) {
  const header = req.headers.authorization ?? "";
  const prefix = "Bearer ";
  return header.startsWith(prefix) ? header.slice(prefix.length).trim() : "";
}

function decodeTokenRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return payload?.role ?? payload?.vars?.role ?? payload?.vrs?.role ?? "admin";
  } catch {
    return "admin";
  }
}

function classifyRpcAccess(rpcId) {
  if (/(_set|_delete|_grant|_reset|_toggle|_schedule|_setup|_broadcast|_send|_update|_import|_invalidate|define|set_alert)$/i.test(rpcId)) {
    return "liveops_write";
  }
  if (/wallet|inventory|mailbox|account|storage|gift|player/i.test(rpcId) && /(grant|reset|send|delete|update|set)/i.test(rpcId)) {
    return "admin_write";
  }
  if (/analytics|intelligence|metrics|taxonomy|cohort|retention|health|events_timeline/i.test(rpcId)) {
    return "analytics_read";
  }
  return "liveops_read";
}

function roleCanAccess(role, access) {
  const normalized = String(role ?? "viewer").toLowerCase();
  if (normalized === "admin") return true;
  if (normalized === "liveops" || normalized === "liveops_operator" || normalized === "operator") {
    return access !== "admin_write";
  }
  if (normalized === "analyst") {
    return access === "analytics_read" || access === "liveops_read";
  }
  return access === "analytics_read" || access === "liveops_read";
}

async function fetchNakamaRpc(rpcId, payload, auth) {
  const params = new URLSearchParams();
  const headers = { "Content-Type": "application/json" };
  let body;

  if (auth.type === "http-key") {
    if (!nakamaHttpKey) {
      return { ok: false, status: 503, body: { success: false, error: "Nakama HTTP key is not configured on the dashboard proxy" } };
    }
    params.set("http_key", nakamaHttpKey);
    params.set("unwrap", "true");
    body = JSON.stringify(payload ?? {});
  } else {
    headers.Authorization = `Bearer ${auth.token}`;
    body = JSON.stringify(JSON.stringify(payload ?? {}));
  }

  const qs = params.toString();
  const response = await fetch(`${nakamaBaseUrl}/v2/rpc/${encodeURIComponent(rpcId)}${qs ? `?${qs}` : ""}`, {
    method: "POST",
    headers,
    body,
  });
  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsed = responseText;
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

async function validateAdminToken(token) {
  if (!token) return false;
  const result = await fetchNakamaRpc("admin_health_check", {}, { type: "bearer", token });
  if (!result.ok || !result.body || result.body.success === false) return false;
  return {
    role: decodeTokenRole(token),
  };
}

async function handleLogin(req, res) {
  const body = await readJson(req);
  const result = await fetchNakamaRpc(
    "admin_login",
    { username: body.username, password: body.password },
    { type: "http-key" },
  );
  if (!result.ok || !result.body || result.body.success === false) {
    sendJson(res, result.status || 401, result.body ?? { success: false, error: "Login failed" });
    return;
  }
  sendJson(res, 200, result.body);
}

async function handleRpc(req, res, rpcId) {
  const token = getBearerToken(req);
  const adminSession = await validateAdminToken(token);
  if (!adminSession) {
    sendJson(res, 401, { success: false, error: "admin authentication required" });
    return;
  }
  const access = classifyRpcAccess(rpcId);
  if (!roleCanAccess(adminSession.role, access)) {
    sendJson(res, 403, { success: false, error: `role '${adminSession.role}' cannot perform ${access}` });
    return;
  }

  const payload = await readJson(req);
  // The proxy has already verified the admin bearer token. Forward privileged
  // dashboard RPCs with the server-side HTTP key so Nakama runtime admin RPCs
  // see a trusted server-to-server context instead of a player context.
  const result = await fetchNakamaRpc(rpcId, payload, { type: "http-key" });
  sendJson(res, result.status, result.body);
}

async function handleHttpProxy(req, res, url) {
  const token = getBearerToken(req);
  const adminSession = await validateAdminToken(token);
  if (!adminSession) {
    sendJson(res, 401, { success: false, error: "admin authentication required" });
    return;
  }
  if (req.method !== "GET" && !roleCanAccess(adminSession.role, "admin_write")) {
    sendJson(res, 403, { success: false, error: `role '${adminSession.role}' cannot proxy Nakama console writes` });
    return;
  }
  if (!consoleAuth) {
    sendJson(res, 503, { success: false, error: "Nakama console auth is not configured on the dashboard proxy" });
    return;
  }

  const targetPath = url.pathname.slice(`${apiPrefix}/http`.length) || "/";
  const target = `${nakamaBaseUrl}${targetPath}${url.search}`;
  const headers = {
    Authorization: consoleAuth,
    "Content-Type": req.headers["content-type"] ?? "application/json",
  };
  const response = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await rawBody(req),
  });
  const responseBody = await response.arrayBuffer();
  res.writeHead(response.status, {
    "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(Buffer.from(responseBody));
}

async function handlePrizeFulfill(req, res) {
  const token = getBearerToken(req);
  const adminSession = await validateAdminToken(token);
  if (!adminSession) {
    sendJson(res, 401, { ok: false, error: "admin authentication required" });
    return;
  }
  // Minting a real gift card spends money — gate on the same write role used
  // for other privileged dashboard actions.
  if (!roleCanAccess(adminSession.role, "admin_write")) {
    sendJson(res, 403, { ok: false, error: `role '${adminSession.role}' cannot fulfill prizes` });
    return;
  }
  if (!liveEventsAdminKey) {
    sendJson(res, 503, {
      ok: false,
      error: "LIVE_EVENTS_ADMIN_KEY is not configured on the dashboard proxy — set it to enable auto-fulfillment",
    });
    return;
  }

  const payload = await readJson(req);
  const eventId = typeof payload.eventId === "string" ? payload.eventId.trim() : "";
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const provider = payload.provider === "reloadly" || payload.provider === "tremendous" ? payload.provider : undefined;
  if (!eventId || !userId) {
    sendJson(res, 400, { ok: false, error: "eventId and userId required" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 422, { ok: false, error: "A valid recipient email is required to deliver the voucher" });
    return;
  }

  const target = `${liveEventsFulfillBaseUrl}/api/live-events/fulfill`;
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": liveEventsAdminKey },
    body: JSON.stringify({ eventId, userId, email, provider }),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { ok: false, error: (text || "").slice(0, 400) || "fulfillment endpoint returned no body" };
  }
  sendJson(res, response.status, parsed ?? { ok: false, error: "fulfillment endpoint returned no body" });
}

function normalizeMetricsSliceBody(body, slice) {
  if (!body || typeof body !== "object") return null;
  // Prod WF-09 often returns flat slice payloads: { dau, wau, ... }
  if (slice === "overview" && body.dau !== undefined) return body;
  if (Array.isArray(body)) return body;
  // Wrapper: { slice, generated_at, data: <payload> }
  if (body.slice && body.data !== undefined) {
    const inner = body.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner) && inner.data !== undefined && inner.slice) {
      return inner.data;
    }
    return inner;
  }
  if (body.data !== undefined) return body.data;
  return body;
}

async function requireAdminSession(req, res, access = "analytics_read") {
  const token = getBearerToken(req);
  const adminSession = await validateAdminToken(token);
  if (!adminSession) {
    sendJson(res, 401, { success: false, error: "admin authentication required" });
    return null;
  }
  if (!roleCanAccess(adminSession.role, access)) {
    sendJson(res, 403, { success: false, error: `role '${adminSession.role}' cannot perform ${access}` });
    return null;
  }
  return adminSession;
}

async function handleQuizverseMetrics(req, res) {
  const session = await requireAdminSession(req, res, "analytics_read");
  if (!session) return;

  if (!quizverseN8nBaseUrl || !quizverseAdminApiToken) {
    sendJson(res, 503, {
      success: false,
      error: "QUIZVERSE_N8N_BASE_URL and QUIZVERSE_ADMIN_API_TOKEN must be set on the admin-dashboard proxy",
    });
    return;
  }

  const payload = req.method === "GET" ? Object.fromEntries(new URL(req.url ?? "/", "http://local").searchParams) : await readJson(req);
  const slice = String(payload.slice ?? "overview");
  const days = Number(payload.days ?? 30) || 30;
  const url = `${quizverseN8nBaseUrl}/webhook/admin/metrics?slice=${encodeURIComponent(slice)}&days=${encodeURIComponent(String(days))}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${quizverseAdminApiToken}`, Accept: "application/json" },
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    sendJson(res, 502, { success: false, error: `WF-09 returned non-JSON (${response.status})` });
    return;
  }
  if (!response.ok) {
    sendJson(res, response.status, { success: false, error: `WF-09 HTTP ${response.status}`, detail: parsed });
    return;
  }

  const sliceData = normalizeMetricsSliceBody(parsed, slice);
  sendJson(res, 200, {
    success: true,
    data: {
      slice,
      generated_at: parsed?.generated_at ?? null,
      days,
      data: sliceData,
    },
  });
}

const GROWTH_WEBHOOKS = {
  gsc: "qv-gsc-snapshot",
  ga4: "qv-ga4-snapshot",
  newsletter: "qv-newsletter-snapshot",
  users: "qv-users-snapshot",
};

async function handleQuizverseGrowth(req, res) {
  const session = await requireAdminSession(req, res, "analytics_read");
  if (!session) return;

  if (!quizverseN8nBaseUrl || !quizverseAdminApiToken) {
    sendJson(res, 503, {
      success: false,
      error: "QUIZVERSE_N8N_BASE_URL and QUIZVERSE_ADMIN_API_TOKEN must be set on the admin-dashboard proxy",
    });
    return;
  }

  const payload = req.method === "GET" ? Object.fromEntries(new URL(req.url ?? "/", "http://local").searchParams) : await readJson(req);
  const source = String(payload.source ?? "");
  const path = GROWTH_WEBHOOKS[source];
  if (!path) {
    sendJson(res, 400, { success: false, error: "invalid source — use gsc, ga4, newsletter, or users" });
    return;
  }

  const url = `${quizverseN8nBaseUrl}/webhook/${path}?token=${encodeURIComponent(quizverseAdminApiToken)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    sendJson(res, 502, { success: false, error: `growth webhook returned non-JSON (${response.status})` });
    return;
  }
  if (!response.ok) {
    sendJson(res, response.status, { success: false, error: `growth HTTP ${response.status}`, detail: parsed });
    return;
  }

  sendJson(res, 200, {
    success: true,
    data: {
      source,
      ok: !!(parsed && parsed.ok),
      snapshot: parsed?.snapshot ?? null,
      error: parsed?.error ?? null,
    },
  });
}

async function rawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function serveStatic(req, res, url) {
  if (url.pathname === "/healthz") {
    sendText(res, 200, "ok\n");
    return;
  }

  if (url.pathname === basePath) {
    res.writeHead(301, { Location: `${basePath}/` });
    res.end();
    return;
  }

  if (
    legacyAnalyticsRedirectPaths.has(url.pathname)
    || url.pathname.startsWith(`${legacyAnalyticsPath}/`)
    || url.pathname.startsWith("/legacy-analytics/")
    || url.pathname.startsWith("/analytics-dashboard/")
  ) {
    res.writeHead(308, {
      Location: canonicalAnalyticsUrl,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end();
    return;
  }

  if (!url.pathname.startsWith(`${basePath}/`)) {
    sendText(res, 404, "not found\n");
    return;
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname.slice(basePath.length + 1));
  } catch {
    sendText(res, 400, "bad request\n");
    return;
  }
  const candidate = resolve(distDir, relativePath || "index.html");
  const safeCandidate = isSafePath(distDir, candidate) ? candidate : join(distDir, "index.html");
  let filePath = join(distDir, "index.html");
  if (existsSync(safeCandidate)) {
    const stat = statSync(safeCandidate);
    if (stat.isFile()) {
      filePath = safeCandidate;
    } else if (stat.isDirectory()) {
      const indexCandidate = join(safeCandidate, "index.html");
      if (isSafePath(distDir, indexCandidate) && existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
        filePath = indexCandidate;
      }
    }
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache, must-revalidate" : "public, max-age=31536000, immutable",
    // Allow embedding from the IntelliVerse admin hub and local dev.
    // CSP frame-ancestors supersedes X-Frame-Options; we clear the old header.
    "Content-Security-Policy": "frame-ancestors 'self' https://admin.intelli-verse-x.ai http://localhost:3000",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === `${apiPrefix}/login` && req.method === "POST") {
      await handleLogin(req, res);
      return;
    }
    if (url.pathname === `${apiPrefix}/prize-fulfill` && req.method === "POST") {
      await handlePrizeFulfill(req, res);
      return;
    }
    if (url.pathname === `${apiPrefix}/quizverse/metrics` && (req.method === "POST" || req.method === "GET")) {
      await handleQuizverseMetrics(req, res);
      return;
    }
    if (url.pathname === `${apiPrefix}/quizverse/growth` && (req.method === "POST" || req.method === "GET")) {
      await handleQuizverseGrowth(req, res);
      return;
    }
    if (url.pathname.startsWith(`${apiPrefix}/rpc/`) && req.method === "POST") {
      await handleRpc(req, res, decodeURIComponent(url.pathname.slice(`${apiPrefix}/rpc/`.length)));
      return;
    }
    if (url.pathname.startsWith(`${apiPrefix}/http/`)) {
      await handleHttpProxy(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "dashboard proxy error",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[admin-dashboard] listening on ${port}, serving ${distDir}, Nakama ${nakamaBaseUrl}`);
});
