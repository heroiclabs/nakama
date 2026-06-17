import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AdminSettings {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  // Globally-selected app for analytics surfaces. "" = all apps (platform-wide).
  selectedAppId: string;
  setSelectedAppId: (id: string) => void;
}

export const useAdminStore = create<AdminSettings>()(
  persist(
    (set) => ({
      // Admin portal lands in dark mode by default.
      theme: "dark",
      setTheme: (theme) => set({ theme }),
      selectedAppId: "",
      setSelectedAppId: (selectedAppId) => set({ selectedAppId }),
    }),
    {
      name: "nakama-admin-settings",
      version: 1,
      // Flip pre-existing installs that were still on the old "system" default
      // over to dark, while preserving any explicit light/dark choice.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<AdminSettings>;
        if (version < 1 && (!state.theme || state.theme === "system")) {
          return { ...state, theme: "dark" } as AdminSettings;
        }
        return state as AdminSettings;
      },
    },
  ),
);
