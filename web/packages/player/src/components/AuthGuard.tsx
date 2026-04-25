import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@nakama/shared";
import { fetchAccount } from "@/lib/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (token && !user) {
      fetchAccount(token)
        .then((u) => setSession(token, refreshToken ?? "", u))
        .catch(() => logout());
    }
  }, [token, user, setSession, refreshToken, logout]);

  if (!token) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

export { AuthGuard as default };
