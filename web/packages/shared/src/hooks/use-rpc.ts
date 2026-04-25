import { useAuthStore } from "../auth/store";
import type { AuthMode, RpcOptions } from "../rpc/client";

/**
 * Returns RpcOptions pre-filled with the current auth mode.
 * Call inside React components / query functions.
 */
export function useRpcOptions(): RpcOptions {
  const getAuthMode = useAuthStore((s) => s.getAuthMode);
  return { auth: getAuthMode() };
}

/**
 * Builds a static RpcOptions for server-key auth (admin).
 */
export function serverKeyAuth(): RpcOptions {
  return { auth: { type: "server-key" } };
}

/**
 * Builds a static RpcOptions for bearer auth (player).
 */
export function bearerAuth(token: string): RpcOptions {
  return { auth: { type: "bearer", token } };
}

/**
 * Utility: merge extra options into a base RpcOptions.
 */
export function withSignal(
  base: RpcOptions,
  signal: AbortSignal,
): RpcOptions {
  return { ...base, signal };
}
