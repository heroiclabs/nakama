import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AdminSettings {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  // Globally-selected app for analytics surfaces. "" = all apps (platform-wide).
  selectedAppId: string;
  // Whether the user has explicitly chosen a scope. Until they do, the
  // selector auto-defaults to the first registered app so a fresh (possibly
  // non-technical) viewer always lands on a concrete, named app rather than
  // the ambiguous "All Apps (combined)" aggregate.
  appSelectionTouched: boolean;
  setSelectedAppId: (id: string) => void;
  // Sets the scope ONLY if the user hasn't picked one yet (no-op otherwise).
  setDefaultAppId: (id: string) => void;
}

export const useAdminStore = create<AdminSettings>()(
  persist(
    (set) => ({
      // Admin portal lands in dark mode by default.
      theme: "dark",
      setTheme: (theme) => set({ theme }),
      selectedAppId: "",
      appSelectionTouched: false,
      setSelectedAppId: (selectedAppId) =>
        set({ selectedAppId, appSelectionTouched: true }),
      setDefaultAppId: (selectedAppId) =>
        set((s) => (s.appSelectionTouched ? s : { ...s, selectedAppId })),
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
