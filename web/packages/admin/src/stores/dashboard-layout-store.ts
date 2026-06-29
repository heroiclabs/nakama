import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_STATUS_SECTION_ORDER = [
  "active-users",
  "crm-error",
  "crm-dual-run",
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

export const DEFAULT_CRM_CARDS_ORDER = [
  "crm-dau",
  "crm-wau",
  "crm-mau",
  "crm-events-24h",
  "crm-players-24h",
  "crm-sponsor-imp",
] as const;

export type CrmCardId = (typeof DEFAULT_CRM_CARDS_ORDER)[number];

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

interface DashboardLayoutState {
  layoutEditMode: boolean;
  statusSectionOrder: StatusSectionId[];
  activeUsersOrder: ActiveUsersWidgetId[];
  crmCardsOrder: CrmCardId[];
  liveopsCardsOrder: LiveopsCardId[];
  topLocationsOrder: TopLocationId[];
  setLayoutEditMode: (enabled: boolean) => void;
  setStatusSectionOrder: (order: StatusSectionId[]) => void;
  setActiveUsersOrder: (order: ActiveUsersWidgetId[]) => void;
  setCrmCardsOrder: (order: CrmCardId[]) => void;
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
      crmCardsOrder: [...DEFAULT_CRM_CARDS_ORDER],
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
          crmCardsOrder: [...DEFAULT_CRM_CARDS_ORDER],
          liveopsCardsOrder: [...DEFAULT_LIVEOPS_CARDS_ORDER],
          topLocationsOrder: [...DEFAULT_TOP_LOCATIONS_ORDER],
        }),
    }),
    {
      name: "nakama-admin-dashboard-layout",
      version: 1,
      partialize: (state) => ({
        statusSectionOrder: state.statusSectionOrder,
        activeUsersOrder: state.activeUsersOrder,
        crmCardsOrder: state.crmCardsOrder,
        liveopsCardsOrder: state.liveopsCardsOrder,
        topLocationsOrder: state.topLocationsOrder,
      }),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<DashboardLayoutState>;
        return {
          ...state,
          statusSectionOrder: normalizeOrder(state.statusSectionOrder, DEFAULT_STATUS_SECTION_ORDER),
          activeUsersOrder: normalizeOrder(state.activeUsersOrder, DEFAULT_ACTIVE_USERS_ORDER),
          crmCardsOrder: normalizeOrder(state.crmCardsOrder, DEFAULT_CRM_CARDS_ORDER),
          liveopsCardsOrder: normalizeOrder(state.liveopsCardsOrder, DEFAULT_LIVEOPS_CARDS_ORDER),
          topLocationsOrder: normalizeOrder(state.topLocationsOrder, DEFAULT_TOP_LOCATIONS_ORDER),
        };
      },
    },
  ),
);
