import { useRef, useCallback, useEffect } from "react";
import { callRpc, serverKeyAuth } from "@nakama/shared";

interface AdminLoginResult {
  token?: string;
  username?: string;
  expiresAt?: number;
  error?: string;
}

interface UseIframeAuthOptions {
  targetUrl: string;
  enabled?: boolean;
  onError?: (error: unknown) => void;
  onSuccess?: (result: AdminLoginResult) => void;
}

interface UseIframeAuthResult {
  iframeRef: React.RefObject<HTMLIFrameElement>;
  handleIframeLoad: () => void;
  postToken: () => Promise<void>;
  isTokenSent: boolean;
}

/**
 * Custom hook for automatic admin panel login across embedded iframes.
 * 
 * @param options Configuration options for iframe authentication
 * @returns Object containing iframe ref, load handler, and token posting function
 * 
 * @example
 * ```tsx
 * const { iframeRef, handleIframeLoad } = useIframeAuth({
 *   targetUrl: 'https://dashboard.example.com',
 *   enabled: true
 * });
 * 
 * return (
 *   <iframe
 *     ref={iframeRef}
 *     src="https://dashboard.example.com"
 *     onLoad={handleIframeLoad}
 *   />
 * );
 * ```
 */
export function useIframeAuth({
  targetUrl,
  enabled = true,
  onError,
  onSuccess,
}: UseIframeAuthOptions): UseIframeAuthResult {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tokenSentRef = useRef(false);
  const targetOriginRef = useRef<string>("");

  // Parse and cache target origin
  useEffect(() => {
    try {
      targetOriginRef.current = new URL(targetUrl).origin;
    } catch (error) {
      console.error("Invalid target URL:", error);
      targetOriginRef.current = "*";
    }
  }, [targetUrl]);

  const postToken = useCallback(async () => {
    if (!enabled || tokenSentRef.current || !iframeRef.current?.contentWindow) {
      return;
    }

    try {
      const result = await callRpc<Record<string, unknown>, AdminLoginResult>(
        "admin_login",
        {},
        serverKeyAuth(),
      );

      if (result?.token && iframeRef.current?.contentWindow) {
        tokenSentRef.current = true;

        iframeRef.current.contentWindow.postMessage(
          {
            type: "IVX_ADMIN_TOKEN",
            token: result.token,
            username: result.username ?? "admin",
            expiresAt: result.expiresAt ?? null,
          },
          targetOriginRef.current,
        );

        onSuccess?.(result);
      }
    } catch (error) {
      console.error("Failed to post admin token to iframe:", error);
      onError?.(error);
    }
  }, [enabled, onError, onSuccess]);

  const handleIframeLoad = useCallback(() => {
    tokenSentRef.current = false;
    postToken();
  }, [postToken]);

  return {
    iframeRef,
    handleIframeLoad,
    postToken,
    isTokenSent: tokenSentRef.current,
  };
}

/**
 * Message handler for iframes that need to listen for admin token
 * 
 * @example
 * ```tsx
 * // In the embedded iframe app
 * useEffect(() => {
 *   const handler = (event: MessageEvent) => {
 *     if (event.data.type === 'IVX_ADMIN_TOKEN') {
 *       const { token, username, expiresAt } = event.data;
 *       // Store token and auto-login
 *     }
 *   };
 *   window.addEventListener('message', handler);
 *   return () => window.removeEventListener('message', handler);
 * }, []);
 * ```
 */
export interface IVXAdminTokenMessage {
  type: "IVX_ADMIN_TOKEN";
  token: string;
  username: string;
  expiresAt: number | null;
}
