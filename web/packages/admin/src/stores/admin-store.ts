import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AdminSettings {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
}

export const useAdminStore = create<AdminSettings>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    { name: "nakama-admin-settings" },
  ),
);
