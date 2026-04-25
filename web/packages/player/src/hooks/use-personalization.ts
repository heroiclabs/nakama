import { useQuery } from "@tanstack/react-query";
import { satori, hiro, useRpcOptions } from "@nakama/shared";
import type { FeatureFlag, LiveEvent } from "@nakama/shared";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BannerBlock {
  title: string;
  subtitle?: string;
  cta: string;
  link: string;
  variant: "event" | "promo" | "comeback" | "season";
}

export interface OfferBlock {
  id: string;
  name: string;
  badge?: string;
  discount?: number;
}

export interface RecommendedBlock {
  id: string;
  label: string;
  description?: string;
  link: string;
  icon?: string;
}

export interface PersonalMessage {
  title: string;
  body?: string;
}

export interface PersonalizationState {
  heroBanner: BannerBlock | null;
  comebackReward: BannerBlock | null;
  targetedOffers: OfferBlock[];
  recommendedActivities: RecommendedBlock[];
  personalMessages: PersonalMessage[];
  activeVariants: Record<string, string>;
  flags: Map<string, FeatureFlag>;
  isLoading: boolean;
}

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function parseJsonFlag<T>(
  flagMap: Map<string, FeatureFlag>,
  key: string,
  fallback: T,
): T {
  const f = flagMap.get(key);
  if (!f?.enabled) return fallback;
  try {
    return JSON.parse(f.value) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/*  hook                                                               */
/* ------------------------------------------------------------------ */

export function usePersonalization(): PersonalizationState {
  const rpc = useRpcOptions();

  const flagsQ = useQuery({
    queryKey: ["personalization", "flags"],
    queryFn: () => satori.getAllFlags(rpc),
    staleTime: 60_000,
    retry: false,
  });

  const experimentsQ = useQuery({
    queryKey: ["personalization", "experiments"],
    queryFn: () => satori.getAllExperiments(rpc),
    staleTime: 60_000,
    retry: false,
  });

  const eventsQ = useQuery<{ events: LiveEvent[] }>({
    queryKey: ["personalization", "events"],
    queryFn: () => satori.listLiveEvents(rpc),
    staleTime: 30_000,
    retry: false,
  });

  const messagesQ = useQuery({
    queryKey: ["personalization", "messages"],
    queryFn: () => satori.listMessages(rpc),
    staleTime: 60_000,
    retry: false,
  });

  const storeQ = useQuery({
    queryKey: ["personalization", "store"],
    queryFn: () => hiro.listStore(rpc),
    staleTime: 60_000,
    retry: false,
  });

  const isLoading = flagsQ.isLoading || eventsQ.isLoading;

  const flagMap = new Map(
    (flagsQ.data?.flags ?? []).filter((f) => f.enabled).map((f) => [f.name, f]),
  );

  /* ---------- hero banner ---------- */
  let heroBanner = parseJsonFlag<BannerBlock | null>(
    flagMap,
    "personalize_hero_banner",
    null,
  );

  if (!heroBanner) {
    const events: LiveEvent[] = eventsQ.data?.events ?? [];
    const now = Math.floor(Date.now() / 1000);
    const live = events.find(
      (e) =>
        e.enabled &&
        (e.start_time_sec ?? 0) <= now &&
        (e.end_time_sec ?? Infinity) >= now,
    );
    if (live) {
      heroBanner = {
        title: live.name,
        subtitle: live.description ?? "Join the live event now!",
        cta: "Join Event",
        link: `/events/${live.id}`,
        variant: "event",
      };
    }
  }

  /* ---------- comeback reward ---------- */
  const comebackReward = parseJsonFlag<BannerBlock | null>(
    flagMap,
    "personalize_comeback",
    null,
  );

  /* ---------- targeted offers ---------- */
  let targetedOffers = parseJsonFlag<OfferBlock[]>(
    flagMap,
    "personalize_offers",
    [],
  );

  if (targetedOffers.length === 0) {
    const raw = storeQ.data as Record<string, unknown> | undefined;
    const storeRoot = (raw?.store ?? raw) as Record<string, unknown> | undefined;
    const items = (storeRoot?.items ?? []) as Record<string, unknown>[];
    const now = Math.floor(Date.now() / 1000);
    targetedOffers = items
      .filter(
        (i) =>
          typeof i.end_time_sec === "number" &&
          i.end_time_sec > now &&
          i.available !== false,
      )
      .slice(0, 4)
      .map((i) => ({
        id: (i.id as string) ?? "",
        name: (i.name as string) ?? (i.id as string) ?? "Offer",
        badge: "Limited",
      }));
  }

  /* ---------- recommended activities ---------- */
  let recommendedActivities = parseJsonFlag<RecommendedBlock[]>(
    flagMap,
    "personalize_recommended",
    [],
  );

  if (recommendedActivities.length === 0) {
    recommendedActivities = [
      {
        id: "events",
        label: "Live Events",
        description: "Join active events",
        link: "/events",
        icon: "calendar",
      },
      {
        id: "quests",
        label: "Daily Quests",
        description: "Complete quests for rewards",
        link: "/quests",
        icon: "scroll",
      },
      {
        id: "battlepass",
        label: "Battle Pass",
        description: "Advance your tier",
        link: "/battlepass",
        icon: "shield",
      },
    ];
  }

  /* ---------- experiments → variant map ---------- */
  const experiments = ((experimentsQ.data as Record<string, unknown>)
    ?.experiments ?? []) as Record<string, unknown>[];
  const activeVariants: Record<string, string> = {};
  for (const exp of experiments) {
    if (
      exp.enabled &&
      Array.isArray(exp.variants) &&
      exp.variants.length > 0
    ) {
      activeVariants[exp.id as string] =
        ((exp.variants as Record<string, unknown>[])[0]?.name as string) ??
        "control";
    }
  }

  /* ---------- personal messages ---------- */
  const rawMsgs = ((messagesQ.data as Record<string, unknown>)?.messages ??
    []) as Record<string, unknown>[];
  const personalMessages: PersonalMessage[] = rawMsgs
    .slice(0, 3)
    .map((m) => ({
      title: (m.title as string) ?? "Notification",
      body: (m.body as string) ?? "",
    }));

  return {
    heroBanner,
    comebackReward,
    targetedOffers,
    recommendedActivities,
    personalMessages,
    activeVariants,
    flags: flagMap,
    isLoading,
  };
}
