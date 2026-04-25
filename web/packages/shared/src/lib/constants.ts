export const NAKAMA_HOST = import.meta.env.VITE_NAKAMA_HOST ?? "localhost";
export const NAKAMA_PORT = import.meta.env.VITE_NAKAMA_PORT ?? "7350";
export const NAKAMA_USE_SSL =
  import.meta.env.VITE_NAKAMA_USE_SSL === "true";

export const NAKAMA_BASE_URL =
  import.meta.env.VITE_NAKAMA_BASE_URL ??
  `${NAKAMA_USE_SSL ? "https" : "http"}://${NAKAMA_HOST}:${NAKAMA_PORT}`;

export const HIRO_SYSTEMS = [
  "economy",
  "inventory",
  "achievements",
  "progression",
  "energy",
  "stats",
  "streaks",
  "event_leaderboards",
  "store",
  "challenges",
  "tutorials",
  "unlockables",
  "auctions",
  "incentives",
] as const;

export const SATORI_SYSTEMS = [
  "audiences",
  "flags",
  "experiments",
  "live_events",
  "messages",
  "metrics",
] as const;

export type HiroSystem = (typeof HIRO_SYSTEMS)[number];
export type SatoriSystem = (typeof SATORI_SYSTEMS)[number];
