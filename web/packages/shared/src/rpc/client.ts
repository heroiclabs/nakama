import { NAKAMA_BASE_URL } from "../lib/constants";

export type AuthMode =
  | { type: "server-key" }
  | { type: "bearer"; token: string };

export interface RpcOptions {
  auth: AuthMode;
  signal?: AbortSignal;
}

const ADMIN_SESSION_STORAGE_KEY = "nakama-admin-session";
const ADMIN_API_BASE = "/admin-dashboard/api";

export class NakamaRpcError extends Error {
  constructor(
    public readonly rpcId: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`RPC ${rpcId} failed with status ${status}`);
    this.name = "NakamaRpcError";
  }
}

function buildAuthHeader(auth: AuthMode): string {
  if (auth.type === "server-key") {
    const token = getStoredAdminToken();
    return token ? `Bearer ${token}` : "";
  }
  return `Bearer ${auth.token}`;
}

function getStoredAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) ??
      window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as { token?: string; expiresAt?: number };
    if (!session.token) return null;
    if (session.expiresAt && session.expiresAt <= Math.floor(Date.now() / 1000)) {
      window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      return null;
    }
    return session.token;
  } catch {
    return null;
  }
}

function parseRpcEnvelope<TResult>(json: unknown): TResult {
  const payload = (json as { payload?: unknown } | null)?.payload;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as TResult;
    } catch {
      return payload as TResult;
    }
  }
  return json as TResult;
}

async function readResponseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Generic RPC caller. All Hiro/Satori/custom RPCs go through POST /v2/rpc/{id}.
 *
 * Two auth modes are supported:
 *  - "server-key": use the Nakama HTTP key as a `?http_key=` query param.
 *    `/v2/rpc/` does NOT accept Basic-auth with the socket server key here —
 *    only the HTTP key (defaulthttpkey) works. We also pass `unwrap=true` so
 *    we can send/receive a bare JSON object on both ends.
 *  - "bearer": user session token. Sent as Authorization header. Body is the
 *    canonical bare-stringified-JSON form Nakama expects on /v2/rpc/.
 */
export async function callRpc<TPayload = Record<string, unknown>, TResult = unknown>(
  rpcId: string,
  payload: TPayload,
  options: RpcOptions,
): Promise<TResult> {
  const isServerKey = options.auth.type === "server-key";
  const url = isServerKey
    ? `${ADMIN_API_BASE}/rpc/${encodeURIComponent(rpcId)}`
    : `${NAKAMA_BASE_URL}/v2/rpc/${rpcId}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeader = buildAuthHeader(options.auth);
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const body = isServerKey
    ? JSON.stringify(payload)
    : JSON.stringify(JSON.stringify(payload));

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: options.signal,
  });

  if (!res.ok) {
    const errBody = await readResponseBody(res);
    throw new NakamaRpcError(rpcId, res.status, errBody);
  }

  const json = await readResponseBody(res);
  return parseRpcEnvelope<TResult>(json);
}

/**
 * Call a custom dashboard-proxy JSON endpoint (NOT a Nakama RPC).
 *
 * These routes live only on the admin-dashboard Node proxy
 * (`server/admin-dashboard-server.mjs`) under `${ADMIN_API_BASE}/...` and let
 * the proxy inject server-side secrets (e.g. the live-events admin key) that
 * must never reach the browser. Only valid with server-key (proxy) auth.
 */
export async function callDashboardApi<TResult = unknown>(
  path: string,
  body: unknown,
  options: RpcOptions,
): Promise<TResult> {
  const url = `${ADMIN_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeader = buildAuthHeader(options.auth);
  if (authHeader) headers.Authorization = authHeader;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    signal: options.signal,
  });

  if (!res.ok) {
    const errBody = await readResponseBody(res);
    throw new NakamaRpcError(path, res.status, errBody);
  }

  if (res.status === 204) return undefined as TResult;
  return readResponseBody(res) as Promise<TResult>;
}

/**
 * Call the Nakama HTTP Console API (port 7350 /v2/ endpoints).
 * Used for account management (ban/unban/delete) and match inspection.
 */
export async function callHttpApi<TResult = unknown>(
  path: string,
  options: RpcOptions & { method?: string; body?: unknown },
): Promise<TResult> {
  const isServerKey = options.auth.type === "server-key";
  const url = isServerKey
    ? `${ADMIN_API_BASE}/http${path}`
    : `${NAKAMA_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeader = buildAuthHeader(options.auth);
  if (authHeader) headers.Authorization = authHeader;

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!res.ok) {
    const body = await readResponseBody(res);
    throw new NakamaRpcError(path, res.status, body);
  }

  if (res.status === 204) return undefined as TResult;
  return readResponseBody(res) as Promise<TResult>;
}
