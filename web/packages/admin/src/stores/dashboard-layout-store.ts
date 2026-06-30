import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_STATUS_SECTION_ORDER = [
  "active-users",
  "analytics-error",
  "product-telemetry",
  "liveops-counts",
  "world-map",
  "top-locations",
] as const;

export type StatusSectionId = (typeof DEFAULT_STATUS_SECTION_ORDER)[number];

export const DEFAULT_ACTIVE_USERS_ORDER = [
  "active-users-5m",
  "active-users-1h",
  "active-users-24h",
] as const;

export type ActiveUsersWidgetId = (typeof DEFAULT_ACTIVE_USERS_ORDER)[number];

export const DEFAULT_GAME_METRICS_CARDS_ORDER = [
  "game-dau",
  "game-wau",
  "game-mau",
  "game-events-today",
  "game-players-today",
] as const;

export type GameMetricsCardId = (typeof DEFAULT_GAME_METRICS_CARDS_ORDER)[number];

/** @deprecated Use GameMetricsCardId — kept for persisted layout migration. */
export type CrmCardId = GameMetricsCardId;

export const DEFAULT_CRM_CARDS_ORDER = DEFAULT_GAME_METRICS_CARDS_ORDER;

export const DEFAULT_LIVEOPS_CARDS_ORDER = [
  "exp-ongoing",
  "live-events-ongoing",
  "exp-scheduled",
  "live-events-scheduled",
  "messages-scheduled",
] as const;

export type LiveopsCardId = (typeof DEFAULT_LIVEOPS_CARDS_ORDER)[number];

export const DEFAULT_TOP_LOCATIONS_ORDER = ["top-countries", "top-cities"] as const;

export type TopLocationId = (typeof DEFAULT_TOP_LOCATIONS_ORDER)[number];

const LEGACY_CARD_IDS = new Set([
  "crm-dau",
  "crm-wau",
  "crm-mau",
  "crm-events-24h",
  "crm-players-24h",
  "crm-sponsor-imp",
]);

const LEGACY_CARD_TO_GAME: Record<string, GameMetricsCardId> = {
  "crm-dau": "game-dau",
  "crm-wau": "game-wau",
  "crm-mau": "game-mau",
  "crm-events-24h": "game-events-today",
  "crm-players-24h": "game-players-today",
  "game-players-24h": "game-players-today",
};

const LEGACY_SECTION_DROP = new Set(["crm-error", "crm-dual-run"]);

function normalizeOrder<T extends string>(saved: T[] | undefined, defaults: readonly T[]): T[] {
  const valid = new Set<string>(defaults);
  const seen = new Set<string>();
  const result: T[] = [];

  for (const id of saved ?? []) {
    if (valid.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of defaults) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

function normalizeGameMetricsCards(saved: string[] | undefined): GameMetricsCardId[] {
  const valid = new Set<string>(DEFAULT_GAME_METRICS_CARDS_ORDER);
  const seen = new Set<string>();
  const result: GameMetricsCardId[] = [];

  for (const id of saved ?? []) {
    let mapped = id;
    if (LEGACY_CARD_IDS.has(id)) {
      if (id === "crm-sponsor-imp") continue;
      mapped = LEGACY_CARD_TO_GAME[id] ?? id;
    }
    if (valid.has(mapped) && !seen.has(mapped)) {
      result.push(mapped as GameMetricsCardId);
      seen.add(mapped);
    }
  }
  for (const id of DEFAULT_GAME_METRICS_CARDS_ORDER) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

function normalizeStatusSections(saved: string[] | undefined): StatusSectionId[] {
  const valid = new Set<string>(DEFAULT_STATUS_SECTION_ORDER);
  const seen = new Set<string>();
  const result: StatusSectionId[] = [];

  for (const id of saved ?? []) {
    if (LEGACY_SECTION_DROP.has(id)) continue;
    if (id === "crm-error") {
      const mapped = "analytics-error";
      if (!seen.has(mapped)) {
        result.push(mapped);
        seen.add(mapped);
      }
      continue;
    }
    if (valid.has(id) && !seen.has(id)) {
      result.push(id as StatusSectionId);
      seen.add(id);
    }
  }
  for (const id of DEFAULT_STATUS_SECTION_ORDER) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

interface DashboardLayoutState {
  layoutEditMode: boolean;
  statusSectionOrder: StatusSectionId[];
  activeUsersOrder: ActiveUsersWidgetId[];
  crmCardsOrder: GameMetricsCardId[];
  liveopsCardsOrder: LiveopsCardId[];
  topLocationsOrder: TopLocationId[];
  setLayoutEditMode: (enabled: boolean) => void;
  setStatusSectionOrder: (order: StatusSectionId[]) => void;
  setActiveUsersOrder: (order: ActiveUsersWidgetId[]) => void;
  setCrmCardsOrder: (order: GameMetricsCardId[]) => void;
  setLiveopsCardsOrder: (order: LiveopsCardId[]) => void;
  setTopLocationsOrder: (order: TopLocationId[]) => void;
  resetStatusLayout: () => void;
}

export const useDashboardLayoutStore = create<DashboardLayoutState>()(
  persist(
    (set) => ({
      layoutEditMode: false,
      statusSectionOrder: [...DEFAULT_STATUS_SECTION_ORDER],
      activeUsersOrder: [...DEFAULT_ACTIVE_USERS_ORDER],
      crmCardsOrder: [...DEFAULT_GAME_METRICS_CARDS_ORDER],
      liveopsCardsOrder: [...DEFAULT_LIVEOPS_CARDS_ORDER],
      topLocationsOrder: [...DEFAULT_TOP_LOCATIONS_ORDER],
      setLayoutEditMode: (layoutEditMode) => set({ layoutEditMode }),
      setStatusSectionOrder: (statusSectionOrder) => set({ statusSectionOrder }),
      setActiveUsersOrder: (activeUsersOrder) => set({ activeUsersOrder }),
      setCrmCardsOrder: (crmCardsOrder) => set({ crmCardsOrder }),
      setLiveopsCardsOrder: (liveopsCardsOrder) => set({ liveopsCardsOrder }),
      setTopLocationsOrder: (topLocationsOrder) => set({ topLocationsOrder }),
      resetStatusLayout: () =>
        set({
          statusSectionOrder: [...DEFAULT_STATUS_SECTION_ORDER],
          activeUsersOrder: [...DEFAULT_ACTIVE_USERS_ORDER],
          crmCardsOrder: [...DEFAULT_GAME_METRICS_CARDS_ORDER],
          liveopsCardsOrder: [...DEFAULT_LIVEOPS_CARDS_ORDER],
          topLocationsOrder: [...DEFAULT_TOP_LOCATIONS_ORDER],
        }),
    }),
    {
      name: "nakama-admin-dashboard-layout",
      version: 2,
      partialize: (state) => ({
        statusSectionOrder: state.statusSectionOrder,
        activeUsersOrder: state.activeUsersOrder,
        crmCardsOrder: state.crmCardsOrder,
        liveopsCardsOrder: state.liveopsCardsOrder,
        topLocationsOrder: state.topLocationsOrder,
      }),
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<DashboardLayoutState>;
        return {
          ...state,
          statusSectionOrder: normalizeStatusSections(state.statusSectionOrder as string[] | undefined),
          activeUsersOrder: normalizeOrder(state.activeUsersOrder, DEFAULT_ACTIVE_USERS_ORDER),
          crmCardsOrder: normalizeGameMetricsCards(state.crmCardsOrder as string[] | undefined),
          liveopsCardsOrder: normalizeOrder(state.liveopsCardsOrder, DEFAULT_LIVEOPS_CARDS_ORDER),
          topLocationsOrder: normalizeOrder(state.topLocationsOrder, DEFAULT_TOP_LOCATIONS_ORDER),
          ...(version < 2 ? {} : {}),
        };
      },
    },
  ),
);
