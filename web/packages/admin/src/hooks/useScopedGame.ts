import { useQuery } from "@tanstack/react-query";
import { serverKeyAuth, satori, type RegisteredApp } from "@nakama/shared";
import { useAdminStore } from "@/stores/admin-store";

/**
 * Single source of truth for the console-wide "which app am I looking at?"
 * scope. Every page reads this instead of keeping its own local Game ID box,
 * so picking an app in the top-bar selector instantly scopes the whole console.
 *
 * The selected value is the app's registry id (UUID). Backend RPCs normalise
 * that to the app's canonical config scope (see ConfigLoader /
 * LegacyGameRegistry.resolveCanonicalGameId), and analytics RPCs already accept
 * the UUID — so the same id works everywhere.
 *
 * `""` (the "All Apps (combined)" option) → `undefined` → platform-wide.
 */
export function useScopedGameId(): string | undefined {
  const selectedAppId = useAdminStore((s) => s.selectedAppId);
  return selectedAppId ? selectedAppId : undefined;
}

/** Shared registry list query (deduped with the top-bar AppSelector). */
export function useAppRegistry() {
  return useQuery({
    queryKey: ["admin", "apps", "selector"],
    queryFn: () => satori.getGameRegistry(serverKeyAuth()),
    select: (d) => d.games ?? [],
    retry: 1,
    staleTime: 60_000,
  });
}

export interface ActiveApp {
  appId: string | undefined;
  /** Human label for the current scope, e.g. "QuizVerse" or "All Apps (combined)". */
  label: string;
  app: RegisteredApp | undefined;
  isAllApps: boolean;
}

/** Resolves the active scope to a display label for page headers / badges. */
export function useActiveApp(): ActiveApp {
  const selectedAppId = useAdminStore((s) => s.selectedAppId);
  const { data: apps } = useAppRegistry();
  const app = selectedAppId
    ? (apps ?? []).find((a) => a.id === selectedAppId)
    : undefined;
  return {
    appId: selectedAppId || undefined,
    isAllApps: !selectedAppId,
    app,
    label: selectedAppId
      ? (app?.title ?? `${selectedAppId.slice(0, 8)}…`)
      : "All Apps (combined)",
  };
}
