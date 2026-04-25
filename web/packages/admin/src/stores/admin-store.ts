import { create } from "zustand";
import { persist } from "zustand/middleware";
import { NAKAMA_SERVER_KEY } from "@nakama/shared";

interface AdminSettings {
  serverKeyOverride: string | null;
  theme: "light" | "dark" | "system";
  setServerKeyOverride: (key: string | null) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
}

export const useAdminStore = create<AdminSettings>()(
  persist(
    (set) => ({
      serverKeyOverride: null,
      theme: "system",
      setServerKeyOverride: (key) => set({ serverKeyOverride: key }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "nakama-admin-settings" },
  ),
);

export function getEffectiveServerKey() {
  const { serverKeyOverride } = useAdminStore.getState();
  return serverKeyOverride ?? NAKAMA_SERVER_KEY;
}
