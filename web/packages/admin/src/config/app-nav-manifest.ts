/**
 * Per-app sidebar visibility manifest.
 *
 * Most LiveOps / Insights / Configuration nav items (Feature Flags,
 * Experiments, Messages, Funnels & Retention, Metrics, Reports, Hiro/Satori
 * Config, Quests, Battle Pass, Achievements, Leaderboards, Economy, etc.)
 * are generic Hiro/Satori framework systems — ANY registered app can
 * configure and use them, scoped by game_id. They are visible for every
 * app by default and need no entry here.
 *
 * A small number of nav items are hard-wired to a single game's backend
 * module and their RPCs don't even accept a game_id — using them while a
 * different app is selected would silently show that one game's data
 * regardless of the top-bar selection. List those paths here, keyed by the
 * app slug whose backend actually powers them; every other selected app
 * has that item hidden from the sidebar.
 *
 * Unknown / not-yet-classified apps (i.e. any slug not used as a key below)
 * see every nav item — this is a deliberate safe default so a newly
 * registered app is never left with a broken or empty sidebar just because
 * nobody updated this file yet.
 */
export const GAME_EXCLUSIVE_NAV_PATHS: Record<string, string[]> = {
  // Live Event Prizes → admin_prize_fulfillments_list / settle / auto-fulfill
  // are QuizVerse-only RPCs today (no game_id parameter on the backend).
  quizverse: ["/prizes"],
};

/**
 * Returns the set of nav `to` paths that should be hidden for the given
 * app slug. Pass `undefined` for the "All Apps (combined)" scope, which
 * always shows every item.
 */
export function hiddenNavPathsForApp(slug: string | undefined): Set<string> {
  const hidden = new Set<string>();
  if (!slug) return hidden;

  for (const [ownerSlug, paths] of Object.entries(GAME_EXCLUSIVE_NAV_PATHS)) {
    if (ownerSlug !== slug) {
      for (const p of paths) hidden.add(p);
    }
  }
  return hidden;
}
