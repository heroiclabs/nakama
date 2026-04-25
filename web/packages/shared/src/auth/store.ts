import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthMode } from "../rpc/client";
import type { NakamaUser } from "../rpc/types";

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: NakamaUser | null;
  isAdmin: boolean;

  setSession: (token: string, refreshToken: string, user: NakamaUser) => void;
  setAdminMode: (isAdmin: boolean) => void;
  logout: () => void;
  getAuthMode: () => AuthMode;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      user: null,
      isAdmin: false,

      setSession: (token, refreshToken, user) =>
        set({ token, refreshToken, user }),

      setAdminMode: (isAdmin) => set({ isAdmin }),

      logout: () =>
        set({ token: null, refreshToken: null, user: null, isAdmin: false }),

      getAuthMode: (): AuthMode => {
        const state = get();
        if (state.isAdmin) return { type: "server-key" };
        if (state.token) return { type: "bearer", token: state.token };
        return { type: "server-key" };
      },
    }),
    {
      name: "nakama-auth",
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
        isAdmin: state.isAdmin,
      }),
    },
  ),
);
