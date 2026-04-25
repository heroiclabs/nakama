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

export interface AdminSession {
  token: string;
  username: string;
  userId: string;
  role: string;
  expiresAt: number;
}

interface AdminAuthContextValue {
  session: AdminSession | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function readStoredSession(): AdminSession | null {
  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.token || !parsed.expiresAt) return null;
    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(() => readStoredSession());

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
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      window.sessionStorage.removeItem(LEGACY_ANALYTICS_SESSION_STORAGE_KEY);
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
    const nextSession: AdminSession = {
      token: body.token,
      username: body.username ?? username,
      userId: body.userId,
      role: body.role ?? "admin",
      expiresAt: body.expiresAt,
    };
    window.localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    window.sessionStorage.setItem(
      LEGACY_ANALYTICS_SESSION_STORAGE_KEY,
      JSON.stringify({
        token: nextSession.token,
        username: nextSession.username,
        expiresAt: nextSession.expiresAt,
      }),
    );
    setSession(nextSession);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_ANALYTICS_SESSION_STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      session,
      isAuthenticated: !!session,
      login,
      logout,
    }),
    [login, logout, session],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return context;
}
