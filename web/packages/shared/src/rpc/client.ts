import {
  NAKAMA_BASE_URL,
  NAKAMA_HTTP_KEY,
  NAKAMA_SERVER_KEY,
} from "../lib/constants";

export type AuthMode =
  | { type: "server-key" }
  | { type: "bearer"; token: string };

export interface RpcOptions {
  auth: AuthMode;
  signal?: AbortSignal;
}

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
    return `Basic ${btoa(`${NAKAMA_SERVER_KEY}:`)}`;
  }
  return `Bearer ${auth.token}`;
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

  const params = new URLSearchParams();
  if (isServerKey) {
    params.set("http_key", NAKAMA_HTTP_KEY);
    params.set("unwrap", "true");
  }
  const qs = params.toString();
  const url = `${NAKAMA_BASE_URL}/v2/rpc/${rpcId}${qs ? `?${qs}` : ""}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!isServerKey) {
    headers.Authorization = buildAuthHeader(options.auth);
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
    const errBody = await res.json().catch(() => res.text());
    throw new NakamaRpcError(rpcId, res.status, errBody);
  }

  const json = await res.json().catch(() => null as unknown);

  if (isServerKey) {
    return json as TResult;
  }
  const raw = (json as { payload?: unknown } | null)?.payload;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as TResult;
    } catch {
      return raw as TResult;
    }
  }
  return raw as TResult;
}

/**
 * Call the Nakama HTTP Console API (port 7350 /v2/ endpoints).
 * Used for account management (ban/unban/delete) and match inspection.
 */
export async function callHttpApi<TResult = unknown>(
  path: string,
  options: RpcOptions & { method?: string; body?: unknown },
): Promise<TResult> {
  const url = `${NAKAMA_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: buildAuthHeader(options.auth),
  };

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => res.text());
    throw new NakamaRpcError(path, res.status, body);
  }

  if (res.status === 204) return undefined as TResult;
  return res.json() as Promise<TResult>;
}
