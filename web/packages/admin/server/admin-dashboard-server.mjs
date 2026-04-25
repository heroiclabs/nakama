import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(process.env.ADMIN_DASHBOARD_DIST_DIR ?? join(__dirname, "..", "dist"));
const basePath = normalizePrefix(process.env.ADMIN_DASHBOARD_BASE_PATH ?? "/admin-dashboard");
const apiPrefix = `${basePath}/api`;
const port = Number(process.env.PORT ?? process.env.ADMIN_DASHBOARD_PORT ?? 8080);
const nakamaBaseUrl = stripTrailingSlash(process.env.NAKAMA_BASE_URL ?? "http://intelliverse-nakama:7350");
const nakamaHttpKey = process.env.NAKAMA_HTTP_KEY ?? "";
const consoleAuth = process.env.NAKAMA_CONSOLE_BASIC_AUTH
  ?? buildBasicAuth(process.env.NAKAMA_CONSOLE_USERNAME, process.env.NAKAMA_CONSOLE_PASSWORD);

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
  return result.ok && result.body && result.body.success !== false;
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
  if (!(await validateAdminToken(token))) {
    sendJson(res, 401, { success: false, error: "admin authentication required" });
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
  if (!(await validateAdminToken(token))) {
    sendJson(res, 401, { success: false, error: "admin authentication required" });
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
  const filePath = existsSync(safeCandidate) && statSync(safeCandidate).isFile()
    ? safeCandidate
    : join(distDir, "index.html");

  const ext = extname(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache, must-revalidate" : "public, max-age=31536000, immutable",
    "X-Frame-Options": "SAMEORIGIN",
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
