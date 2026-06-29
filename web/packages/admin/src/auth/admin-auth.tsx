import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const ADMIN_SESSION_STORAGE_KEY = "nakama-admin-session";
const LEGACY_ANALYTICS_SESSION_STORAGE_KEY = "ivx_admin_token_v2";
const LEGACY_LOCAL_STORAGE_KEY = "nakama-admin-session";

export interface AdminSession {
  token: string;
  username: string;
  userId: string;
  role: string;
  expiresAt: number;
}

export type AdminAuthPhase = "bootstrapping" | "ready";

interface AdminAuthContextValue {
  session: AdminSession | null;
  isAuthenticated: boolean;
  authPhase: AdminAuthPhase;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function clearStoredSession() {
  window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_ANALYTICS_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
}

function readStoredSession(): AdminSession | null {
  try {
    const raw =
      window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.token || !parsed.expiresAt) return null;
    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      clearStoredSession();
      return null;
    }
    if (!window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY)) {
      persistSession(parsed);
      window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    }
    return parsed;
  } catch {
    clearStoredSession();
    return null;
  }
}

function persistSession(nextSession: AdminSession) {
  window.sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
  window.sessionStorage.setItem(
    LEGACY_ANALYTICS_SESSION_STORAGE_KEY,
    JSON.stringify({
      token: nextSession.token,
      username: nextSession.username,
      expiresAt: nextSession.expiresAt,
    }),
  );
}

function sessionFromLoginBody(body: Record<string, unknown>, username: string): AdminSession {
  return {
    token: String(body.token),
    username: typeof body.username === "string" ? body.username : username,
    userId: typeof body.userId === "string" ? body.userId : "",
    role: typeof body.role === "string" ? body.role : "admin",
    expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : Math.floor(Date.now() / 1000) + 86400,
  };
}

/** Accept session injected by Intelliverse admin portal iframe launch (/api/launch/nakama-analytics). */
function sessionFromIframeMessage(data: Record<string, unknown>): AdminSession | null {
  const type = data.type;
  if (type !== "IVX_ADMIN_TOKEN" && type !== "IVX_NAKAMA_ADMIN_SESSION") {
    return null;
  }

  const token = typeof data.token === "string" ? data.token : "";
  if (!token) return null;

  const expiresAt =
    typeof data.expiresAt === "number" && data.expiresAt > 0
      ? data.expiresAt
      : Math.floor(Date.now() / 1000) + 86400;

  return {
    token,
    username: typeof data.username === "string" ? data.username : "admin",
    userId: typeof data.userId === "string" ? data.userId : "",
    role: typeof data.role === "string" ? data.role : "admin",
    expiresAt,
  };
}

async function fetchAutoLogin(): Promise<AdminSession | null> {
  const response = await fetch("/admin-dashboard/api/auto-login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    console.warn("[admin-auth] auto-login did not return JSON (status %s)", response.status);
    return null;
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.token) {
    console.warn("[admin-auth] auto-login failed:", body?.error ?? response.status);
    return null;
  }
  return sessionFromLoginBody(body as Record<string, unknown>, "ivx-admin");
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const initialSession = readStoredSession();
  const [session, setSession] = useState<AdminSession | null>(initialSession);
  const [authPhase, setAuthPhase] = useState<AdminAuthPhase>(
    initialSession ? "ready" : "bootstrapping",
  );

  // Embedded in admin.intelli-verse-x.ai — accept token from parent launch shell.
  useEffect(() => {
    if (window.self === window.top) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      const nextSession = sessionFromIframeMessage(data as Record<string, unknown>);
      if (!nextSession) return;

      persistSession(nextSession);
      setSession(nextSession);
      setAuthPhase("ready");
    };

    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "IFRAME_READY" }, "*");

    const timer = window.setTimeout(() => {
      setAuthPhase((phase) => (phase === "bootstrapping" ? "ready" : phase));
    }, 2500);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  // Server-side auto-login (credentials never touch the browser bundle).
  useEffect(() => {
    if (initialSession || window.self !== window.top) return;

    let cancelled = false;

    async function bootstrap() {
      try {
        const nextSession = await fetchAutoLogin();
        if (cancelled) return;
        if (nextSession) {
          persistSession(nextSession);
          setSession(nextSession);
        }
      } catch {
        // Fall through to manual login.
      } finally {
        if (!cancelled) setAuthPhase("ready");
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [initialSession]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    window.sessionStorage.setItem(
      LEGACY_ANALYTICS_SESSION_STORAGE_KEY,
      JSON.stringify({
        token: session.token,
        username: session.username,
        expiresAt: session.expiresAt,
      }),
    );
    const delayMs = Math.max(0, session.expiresAt * 1000 - Date.now());
    const timer = window.setTimeout(() => {
      clearStoredSession();
      setSession(null);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [session]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch("/admin-dashboard/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.token) {
      throw new Error(body?.error ?? "Login failed");
    }
    const nextSession = sessionFromLoginBody(body as Record<string, unknown>, username);
    persistSession(nextSession);
    setSession(nextSession);
  }, []);

  const logout = useCallback(() => {
    clearStoredSession();
    setSession(null);
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      session,
      isAuthenticated: !!session,
      authPhase,
      login,
      logout,
    }),
    [authPhase, login, logout, session],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return context;
}
