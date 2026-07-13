// aahaa_catalog.ts
// ─────────────────────────────────────────────────────────────────────────────
// Aahaa engine — the deducible Wow-Moment catalog (CATALOG-WOW_MOMENTS.md).
//
// Every entry ships the six non-negotiable fields (wow_id, trigger, surface,
// copy, loop_event, mechanic) PLUS:
//   data_sources[]   — fact-pack fields the trigger + copy read (lineage lint)
//   priority_class   — trust > engagement > monetisation (the respect ladder)
//   celebratory      — blocked within the frustration window (tail_wrong_run≥3)
//   fullscreen       — counts against the 1-fullscreen-per-day cap
//   cooldown_days    — per-wow cooldown (server-enforced)
//
// The eval() of each entry is a pure function FactPack → vars|null. If it
// returns null the wow does not fire. No entry may cite a value that is not
// in the fact pack — that is the structural no-hallucination guarantee.

namespace AahaaCatalog {

  export interface WowCandidate {
    wow_id: string;
    tier: string;
    vars: { [k: string]: any };
    score: number;
    signal: string;               // human-readable "why this appeared" chip
  }

  export interface CatalogEntry {
    wow_id: string;
    tier: string;                 // S | A | B | C | D | E
    surface: string;              // canonical render surface (web route / Unity host)
    copy_template: string;        // EN template with {vars}
    cta_action_id: string;
    loop_event: string;
    mechanic: string;             // NI/PC/CB/MA/LA/SU/BL/RC/HF/FP/DI codes
    priority_class: string;       // trust | engagement | monetisation
    celebratory: boolean;
    fullscreen: boolean;
    cooldown_days: number;
    base_score: number;
    data_sources: string[];
    eval: (facts: AahaaFacts.FactPack, profile: any) => WowCandidate | null;
  }

  function mk(entry: CatalogEntry): CatalogEntry { return entry; }

  function firstName(facts: AahaaFacts.FactPack): string {
    return facts.identity.username || "player";
  }

  // Milestone helper: returns the highest threshold crossed that has not been
  // fired yet (profile.milestones[msKey] stores the last fired threshold).
  function pendingMilestone(value: number, thresholds: number[], profile: any, msKey: string): number {
    var fired = (profile && profile.milestones && profile.milestones[msKey]) || 0;
    var hit = 0;
    for (var i = 0; i < thresholds.length; i++) {
      if (value >= thresholds[i] && thresholds[i] > fired) hit = thresholds[i];
    }
    return hit;
  }

  export function catalog(): CatalogEntry[] {
    return [

      // ── TIER S — life-changing ───────────────────────────────────────────
      mk({
        wow_id: "wow.s.thousand_questions", tier: "S",
        surface: "web:/me/celebration/[milestone_id] (Unity: WebSurfaceLauncher modal)",
        copy_template: "Your {milestone}th question, {first_name}. Top topic: {topic}. The {milestone}-question badge is yours forever.",
        cta_action_id: "open_milestone_share", loop_event: "milestone_share_tapped",
        mechanic: "MA+NI", priority_class: "trust", celebratory: true, fullscreen: true,
        cooldown_days: 1, base_score: 96,
        data_sources: ["lifetime.questions_answered", "topics.top3", "identity.username"],
        eval: function (facts, profile) {
          var hit = pendingMilestone(facts.lifetime.questions_answered, [100, 500, 1000, 5000, 10000], profile, "questions");
          if (hit === 0) return null;
          return {
            wow_id: "wow.s.thousand_questions", tier: "S",
            vars: { milestone: hit, first_name: firstName(facts), topic: facts.topics.top3[0] || "general knowledge" },
            score: 0,
            signal: "lifetime questions_answered crossed " + hit + " (currently " + facts.lifetime.questions_answered + ")"
          };
        }
      }),

      mk({
        wow_id: "wow.s.year_in_quizverse", tier: "S",
        surface: "web:/me/celebration/[milestone_id] (Unity: WebSurfaceLauncher modal)",
        copy_template: "{days} days in QuizVerse. {question_count} questions answered, {fact_count} facts locked in. {topic_top_3} were your obsessions. Your archetype: {archetype}.",
        cta_action_id: "open_anniversary_card", loop_event: "anniversary_share_tapped",
        mechanic: "NI", priority_class: "trust", celebratory: true, fullscreen: true,
        cooldown_days: 1, base_score: 95,
        data_sources: ["identity.days_since_install", "lifetime.questions_answered", "lifetime.questions_correct", "topics.top3", "derived.personality_archetype"],
        eval: function (facts, profile) {
          var hit = pendingMilestone(facts.identity.days_since_install, [30, 100, 365], profile, "anniversary");
          if (hit === 0 || facts.lifetime.questions_answered < 10) return null;
          return {
            wow_id: "wow.s.year_in_quizverse", tier: "S",
            vars: {
              days: hit, question_count: facts.lifetime.questions_answered,
              fact_count: facts.lifetime.questions_correct,
              topic_top_3: facts.topics.top3.join(", ") || "everything",
              archetype: facts.derived.personality_archetype
            },
            score: 0,
            signal: "days_since_install crossed " + hit
          };
        }
      }),

      mk({
        wow_id: "wow.s.you_did_it_exam_passed", tier: "S",
        surface: "web:/me/celebration/[milestone_id] + AIHost voiceover (Unity native captions)",
        copy_template: "Today was {exam}. You answered {question_count} questions preparing for it. However it went, you showed up. We're proud of you.",
        cta_action_id: "open_post_exam_followup", loop_event: "post_exam_followup_started",
        mechanic: "NI+LA", priority_class: "trust", celebratory: false, fullscreen: true,
        cooldown_days: 30, base_score: 99,
        data_sources: ["onboarding.target_exam_id", "onboarding.days_to_exam", "lifetime.questions_answered"],
        eval: function (facts, profile) {
          if (!facts.onboarding.target_exam_id) return null;
          var d = facts.onboarding.days_to_exam;
          if (d > 0 || d < -3 || d === -1 && !facts.onboarding.exam_date_iso) return null;
          if (!facts.onboarding.exam_date_iso) return null;
          return {
            wow_id: "wow.s.you_did_it_exam_passed", tier: "S",
            vars: { exam: facts.onboarding.target_exam_id.toUpperCase(), question_count: facts.lifetime.questions_answered },
            score: 0,
            signal: "user-set exam date " + facts.onboarding.exam_date_iso + " reached (days_to_exam=" + d + ")"
          };
        }
      }),

      mk({
        wow_id: "wow.s.birthday_quiz", tier: "S",
        surface: "web:/me/celebration/birthday (first app_open of the day)",
        copy_template: "Happy birthday, {first_name}. We made you a quiz from {topic_top_3} — no energy cost, custom from your year of learning.",
        cta_action_id: "start_birthday_quiz", loop_event: "birthday_quiz_started",
        mechanic: "NI+BL", priority_class: "trust", celebratory: true, fullscreen: true,
        cooldown_days: 300, base_score: 97,
        data_sources: ["onboarding.birthday", "topics.top3", "identity.username"],
        eval: function (facts, profile) {
          var bday = "" + (facts.onboarding.birthday || "");
          if (bday.length < 5) return null;
          // Anti-fake guard: birthday must have been set ≥30 days ago.
          var setMs = (profile && profile.onboarding && profile.onboarding.birthday_set_ms) || 0;
          if (setMs === 0 || (Date.now() - setMs) < 30 * 86400000) return null;
          var today = new Date().toISOString().slice(5, 10); // "MM-DD"
          if (bday.slice(5, 10) !== today && bday.slice(0, 5) !== today) return null;
          return {
            wow_id: "wow.s.birthday_quiz", tier: "S",
            vars: { first_name: firstName(facts), topic_top_3: facts.topics.top3.join(", ") || "your favourites" },
            score: 0,
            signal: "user-set birthday matches today; set " + Math.floor((Date.now() - setMs) / 86400000) + "d ago"
          };
        }
      }),

      // ── TIER A — daily dopamine ──────────────────────────────────────────
      mk({
        wow_id: "wow.a.lock_it_in", tier: "A",
        surface: "web:/me/wow/[wow_id] (post-quiz; Unity: WebSurfaceLauncher after quiz_completed)",
        copy_template: "You nailed {topic} — {run} in a row. Lock it in with a 3-day Smart Review?",
        cta_action_id: "enroll_smart_review", loop_event: "smart_review_accepted",
        mechanic: "MA+LA", priority_class: "engagement", celebratory: true, fullscreen: false,
        cooldown_days: 1, base_score: 78,
        data_sources: ["recent.lock_topic", "recent.lock_run"],
        eval: function (facts, profile) {
          if (facts.recent.lock_run < 5 || !facts.recent.lock_topic) return null;
          return {
            wow_id: "wow.a.lock_it_in", tier: "A",
            vars: { topic: facts.recent.lock_topic, run: facts.recent.lock_run },
            score: facts.recent.lock_run,
            signal: facts.recent.lock_run + " consecutive correct on '" + facts.recent.lock_topic + "' at the end of the ledger"
          };
        }
      }),

      mk({
        wow_id: "wow.a.weakness_targeted", tier: "A",
        surface: "web:/me/wow/[wow_id] OR AIHost intro (Unity native captions)",
        copy_template: "I noticed you're stuck on {topic} — {wrong} misses in your recent questions. Want a 5-min explainer + 3 fresh questions?",
        cta_action_id: "start_weakness_quiz", loop_event: "weakness_targeted_quiz_started",
        mechanic: "SU+MA", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 2, base_score: 85,
        data_sources: ["recent.struggling_topic", "recent.struggling_wrong"],
        eval: function (facts, profile) {
          if (!facts.recent.struggling_topic) return null;
          return {
            wow_id: "wow.a.weakness_targeted", tier: "A",
            vars: { topic: facts.recent.struggling_topic, wrong: facts.recent.struggling_wrong },
            score: facts.recent.struggling_wrong * 2,
            signal: facts.recent.struggling_wrong + " wrong on '" + facts.recent.struggling_topic + "' inside the newest " + facts.recent.window + " answers"
          };
        }
      }),

      mk({
        wow_id: "wow.a.warming_up", tier: "A",
        surface: "Unity mid-quiz toast (latency-critical, stays native)",
        copy_template: "{run} in a row. You're flying.",
        cta_action_id: "none", loop_event: "wow_moment_clicked",
        mechanic: "FP+MA", priority_class: "engagement", celebratory: true, fullscreen: false,
        cooldown_days: 1, base_score: 60,
        data_sources: ["recent.tail_correct_run"],
        eval: function (facts, profile) {
          if (facts.recent.tail_correct_run < 5) return null;
          return {
            wow_id: "wow.a.warming_up", tier: "A",
            vars: { run: facts.recent.tail_correct_run },
            score: facts.recent.tail_correct_run,
            signal: "current correct run of " + facts.recent.tail_correct_run + " at the tail of the answer ledger"
          };
        }
      }),

      mk({
        wow_id: "wow.a.goal_progress", tier: "A",
        surface: "web:/me (home hero card)",
        copy_template: "{first_name}, {days_to_exam} days to {exam}. You've answered {answered} questions — your recent accuracy is {recent_acc}%.",
        cta_action_id: "start_next_8_quizzes", loop_event: "goal_card_clicked",
        mechanic: "CB+MA", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 1, base_score: 80,
        data_sources: ["onboarding.days_to_exam", "onboarding.target_exam_id", "lifetime.questions_answered", "recent.accuracy_pct"],
        eval: function (facts, profile) {
          if (!facts.onboarding.target_exam_id || facts.onboarding.days_to_exam <= 0) return null;
          return {
            wow_id: "wow.a.goal_progress", tier: "A",
            vars: {
              first_name: firstName(facts), days_to_exam: facts.onboarding.days_to_exam,
              exam: facts.onboarding.target_exam_id.toUpperCase(),
              answered: facts.lifetime.questions_answered, recent_acc: facts.recent.accuracy_pct
            },
            score: facts.onboarding.days_to_exam <= 30 ? 20 : 5,
            signal: "user-set exam goal with " + facts.onboarding.days_to_exam + " days remaining"
          };
        }
      }),

      mk({
        wow_id: "wow.a.improvement_surge", tier: "A",
        surface: "web:/me/wow/[wow_id] (post-quiz)",
        copy_template: "Your accuracy is up {pts} points across your newest questions vs the batch before. Quietly getting sharper.",
        cta_action_id: "open_growth_dashboard", loop_event: "growth_dashboard_opened",
        mechanic: "MA+NI", priority_class: "trust", celebratory: true, fullscreen: false,
        cooldown_days: 7, base_score: 72,
        data_sources: ["recent.improvement_pts"],
        eval: function (facts, profile) {
          if (facts.recent.improvement_pts < 10) return null;
          return {
            wow_id: "wow.a.improvement_surge", tier: "A",
            vars: { pts: facts.recent.improvement_pts },
            score: facts.recent.improvement_pts,
            signal: "newest-half vs prior-half accuracy delta = +" + facts.recent.improvement_pts + " pts"
          };
        }
      }),

      // ── TIER B — habit-shaping ───────────────────────────────────────────
      mk({
        wow_id: "wow.b.weekly_recap", tier: "B",
        surface: "web:/me (home hero) + push deep-link /me/wow/[id]",
        copy_template: "Your week: {answered} questions · {acc}% accuracy · top topics {topics}. Tap for the full recap.",
        cta_action_id: "open_weekly_recap", loop_event: "weekly_recap_opened",
        mechanic: "NI+CB", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 6, base_score: 65,
        data_sources: ["recent.answered", "recent.accuracy_pct", "topics.top3"],
        eval: function (facts, profile) {
          if (facts.recent.answered < 20) return null;
          return {
            wow_id: "wow.b.weekly_recap", tier: "B",
            vars: { answered: facts.recent.answered, acc: facts.recent.accuracy_pct, topics: facts.topics.top3.join(", ") },
            score: 0,
            signal: facts.recent.answered + " answers in the recent window (≥20 threshold)"
          };
        }
      }),

      mk({
        wow_id: "wow.b.return_after_long_gap", tier: "B",
        surface: "web:/me (home hero)",
        copy_template: "Welcome back, {first_name} — {days} days away. We saved your top topic: {topic}. Pick up where you left off?",
        cta_action_id: "resume_from_last_topic", loop_event: "resume_from_last_topic",
        mechanic: "LA+RC", priority_class: "trust", celebratory: false, fullscreen: false,
        cooldown_days: 7, base_score: 88,
        data_sources: ["lifetime.days_since_last_played", "topics.top3", "identity.username"],
        eval: function (facts, profile) {
          var d = facts.lifetime.days_since_last_played;
          if (d < 7) return null;
          return {
            wow_id: "wow.b.return_after_long_gap", tier: "B",
            vars: { first_name: firstName(facts), days: d, topic: facts.topics.top3[0] || "your last quiz" },
            score: 15,
            signal: "last stats write was " + d + " days ago"
          };
        }
      }),

      mk({
        wow_id: "wow.b.month_summary", tier: "B",
        surface: "web:/me/celebration/month (small variant, not fullscreen)",
        copy_template: "Your month: {games} quizzes, {acc}% lifetime accuracy, {topics} on the podium. Set a goal for next month?",
        cta_action_id: "set_monthly_goal", loop_event: "monthly_goal_set",
        mechanic: "CB+NI", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 25, base_score: 62,
        data_sources: ["lifetime.total_games", "lifetime.accuracy_pct", "topics.top3"],
        eval: function (facts, profile) {
          if (facts.lifetime.total_games < 3) return null;
          var monthKey = new Date().toISOString().slice(0, 7);
          if (profile && profile.milestones && profile.milestones.month_summary === monthKey) return null;
          return {
            wow_id: "wow.b.month_summary", tier: "B",
            vars: { games: facts.lifetime.total_games, acc: facts.lifetime.accuracy_pct, topics: facts.topics.top3.join(", ") },
            score: 0,
            signal: "first feed generation in calendar month " + monthKey
          };
        }
      }),

      mk({
        wow_id: "wow.b.comeback_kid", tier: "B",
        surface: "web:/me/reveal (settings reveal card)",
        copy_template: "You bounced back after 3 straight misses {n} times recently. Your resilience is a pattern, not luck.",
        cta_action_id: "open_reveal_screen", loop_event: "reveal_screen_opened",
        mechanic: "NI+MA", priority_class: "trust", celebratory: false, fullscreen: false,
        cooldown_days: 7, base_score: 70,
        data_sources: ["recent.comebacks_after_3_wrong"],
        eval: function (facts, profile) {
          if (facts.recent.comebacks_after_3_wrong < 2) return null;
          return {
            wow_id: "wow.b.comeback_kid", tier: "B",
            vars: { n: facts.recent.comebacks_after_3_wrong },
            score: facts.recent.comebacks_after_3_wrong,
            signal: facts.recent.comebacks_after_3_wrong + " comeback sequences (3+ wrong then correct) in the recent window"
          };
        }
      }),

      // ── TIER C — per-mode signature ──────────────────────────────────────
      mk({
        wow_id: "wow.c.speed_pr", tier: "C",
        surface: "web:/me/wow/[wow_id] (post-quiz)",
        copy_template: "New pace: {recent_s}s per question in your recent answers — faster than your lifetime {lifetime_s}s average.",
        cta_action_id: "share_speed_pr", loop_event: "speed_pr_shared",
        mechanic: "MA", priority_class: "engagement", celebratory: true, fullscreen: false,
        cooldown_days: 14, base_score: 66,
        data_sources: ["recent.avg_time_ms", "lifetime.avg_time_ms", "recent.answered"],
        eval: function (facts, profile) {
          if (facts.recent.answered < 20 || facts.recent.avg_time_ms <= 0 || facts.lifetime.avg_time_ms <= 0) return null;
          if (facts.recent.avg_time_ms > facts.lifetime.avg_time_ms * 0.8) return null;
          return {
            wow_id: "wow.c.speed_pr", tier: "C",
            vars: {
              recent_s: Math.round(facts.recent.avg_time_ms / 100) / 10,
              lifetime_s: Math.round(facts.lifetime.avg_time_ms / 100) / 10
            },
            score: 5,
            signal: "recent avg_time_ms " + facts.recent.avg_time_ms + " ≤ 80% of lifetime " + facts.lifetime.avg_time_ms
          };
        }
      }),

      mk({
        wow_id: "wow.c.mode_specialist", tier: "C",
        surface: "web:/me/reveal (archetype card)",
        copy_template: "{pct}% of your {games} games are {mode}. You're a Specialist — want the deep-dive {mode} pack?",
        cta_action_id: "open_mode_pack", loop_event: "mode_pack_opened",
        mechanic: "NI+DI", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 14, base_score: 64,
        data_sources: ["modes.top_mode", "modes.top_mode_share_pct", "lifetime.total_games"],
        eval: function (facts, profile) {
          if (facts.modes.top_mode_share_pct < 60 || facts.modes.top_mode_games < 10) return null;
          return {
            wow_id: "wow.c.mode_specialist", tier: "C",
            vars: { pct: facts.modes.top_mode_share_pct, games: facts.lifetime.total_games, mode: facts.modes.top_mode },
            score: 0,
            signal: "top mode '" + facts.modes.top_mode + "' holds " + facts.modes.top_mode_share_pct + "% of " + facts.lifetime.total_games + " games"
          };
        }
      }),

      mk({
        wow_id: "wow.c.renaissance_learner", tier: "C",
        surface: "web:/me/reveal (archetype card)",
        copy_template: "You've played {n} distinct modes. Renaissance brain — most players stick to 2.",
        cta_action_id: "open_mode_catalog", loop_event: "mode_catalog_opened",
        mechanic: "NI+DI", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 30, base_score: 58,
        data_sources: ["modes.distinct"],
        eval: function (facts, profile) {
          if (facts.modes.distinct < 6) return null;
          return {
            wow_id: "wow.c.renaissance_learner", tier: "C",
            vars: { n: facts.modes.distinct },
            score: 0,
            signal: facts.modes.distinct + " distinct modes in quiz_user_stats.modeStats"
          };
        }
      }),

      mk({
        wow_id: "wow.c.aifortuneteller_lucky_mode", tier: "C",
        surface: "AIFortuneTeller (Unity native; ONLY when user opened Fortune Teller)",
        copy_template: "Your lucky arena this week is {mode} — not magic exactly, just a pattern the cards noticed: {pct}% wins there. For fun, based on your recent QuizVerse patterns.",
        cta_action_id: "start_lucky_mode_quiz", loop_event: "lucky_mode_quiz_started",
        mechanic: "NI+SU", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 7, base_score: 50,
        data_sources: ["modes.lucky_mode", "modes.lucky_mode_win_rate_pct"],
        eval: function (facts, profile) {
          if (!facts.modes.lucky_mode || facts.modes.lucky_mode_win_rate_pct < 70) return null;
          return {
            wow_id: "wow.c.aifortuneteller_lucky_mode", tier: "C",
            vars: { mode: facts.modes.lucky_mode, pct: facts.modes.lucky_mode_win_rate_pct },
            score: 0,
            signal: "win rate " + facts.modes.lucky_mode_win_rate_pct + "% over ≥5 games in '" + facts.modes.lucky_mode + "' (soft-signal, entertainment-framed)"
          };
        }
      }),

      // ── TIER D — per-social-action ───────────────────────────────────────
      mk({
        wow_id: "wow.d.first_friend_added", tier: "D",
        surface: "web:/me/friends (friend card highlight; Unity in-match stays native)",
        copy_template: "Your first friend! Compatibility Quiz unlocks at 7 days of friendship.",
        cta_action_id: "open_friend_card", loop_event: "friend_card_opened",
        mechanic: "DI+BL", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 3650, base_score: 68,
        data_sources: ["social.friends_count"],
        eval: function (facts, profile) {
          if (facts.social.friends_count < 1) return null;
          var fired = (profile && profile.milestones && profile.milestones.first_friend) || 0;
          if (fired) return null;
          return {
            wow_id: "wow.d.first_friend_added", tier: "D",
            vars: {},
            score: 0,
            signal: "friends_count moved 0 → " + facts.social.friends_count
          };
        }
      }),

      mk({
        wow_id: "wow.d.network_growing", tier: "D",
        surface: "web:/me/friends (banner)",
        copy_template: "{n} friends in your network now. Active networks win more weekly challenges — start one?",
        cta_action_id: "start_friend_challenge", loop_event: "friend_challenge_started",
        mechanic: "BL+CB", priority_class: "engagement", celebratory: false, fullscreen: false,
        cooldown_days: 14, base_score: 55,
        data_sources: ["social.friends_count"],
        eval: function (facts, profile) {
          var hit = pendingMilestone(facts.social.friends_count, [5, 10, 25], profile, "friends");
          if (hit === 0) return null;
          return {
            wow_id: "wow.d.network_growing", tier: "D",
            vars: { n: facts.social.friends_count },
            score: 0,
            signal: "friends_count crossed " + hit
          };
        }
      }),

      // ── TIER E — ambient / intercepts ────────────────────────────────────
      mk({
        wow_id: "wow.e.pool_exhausted", tier: "E",
        surface: "web:/me/wow/[wow_id] (EndOfQuizReviewScreen intercept)",
        copy_template: "You just answered every {topic} question we have, {first_name}. You literally beat the game. We're generating more right now — want to try {recommended_topic} while you wait?",
        cta_action_id: "start_recommended_topic", loop_event: "recommended_topic_started",
        mechanic: "MA+DI", priority_class: "trust", celebratory: false, fullscreen: false,
        cooldown_days: 1, base_score: 92,
        data_sources: ["seedq.exhausted_pools_7d", "topics.top3", "identity.username"],
        eval: function (facts, profile) {
          if (!facts.seedq.exhausted_pools_7d || facts.seedq.exhausted_pools_7d.length === 0) return null;
          var last = facts.seedq.exhausted_pools_7d[facts.seedq.exhausted_pools_7d.length - 1];
          var topic = last.split("/")[1] || last;
          var rec = "";
          for (var i = 0; i < facts.topics.top3.length; i++) {
            if (SeedQ.slugify(facts.topics.top3[i]) !== SeedQ.slugify(topic)) { rec = facts.topics.top3[i]; break; }
          }
          return {
            wow_id: "wow.e.pool_exhausted", tier: "E",
            vars: { topic: topic, recommended_topic: rec || "a new topic", first_name: firstName(facts) },
            score: 30,
            signal: "seedq staged engine reported pool_exhausted for " + last + " within 7d (App Store rating prompt suppressed)"
          };
        }
      }),

      mk({
        wow_id: "wow.e.frustration_softpause", tier: "E",
        surface: "Unity mid-quiz toast (latency-critical, stays native)",
        copy_template: "Want a hint, or skip this one? {topic} will still be here after a 2-min break.",
        cta_action_id: "offer_hint_or_skip", loop_event: "softpause_accepted",
        mechanic: "FP+RC", priority_class: "trust", celebratory: false, fullscreen: false,
        cooldown_days: 1, base_score: 90,
        data_sources: ["recent.tail_wrong_run", "recent.struggling_topic"],
        eval: function (facts, profile) {
          if (facts.recent.tail_wrong_run < 3) return null;
          return {
            wow_id: "wow.e.frustration_softpause", tier: "E",
            vars: { topic: facts.recent.struggling_topic || "this topic" },
            score: facts.recent.tail_wrong_run * 3,
            signal: facts.recent.tail_wrong_run + " wrong in a row at the tail of the ledger (celebratory wows blocked this session)"
          };
        }
      }),

      mk({
        wow_id: "wow.e.morning_greeting", tier: "E",
        surface: "web:/me (welcome line replaces generic greeting)",
        copy_template: "Good {bucket}, {first_name}. {stat}.",
        cta_action_id: "none", loop_event: "wow_moment_clicked",
        mechanic: "HF+NI", priority_class: "trust", celebratory: false, fullscreen: false,
        cooldown_days: 1, base_score: 40,
        data_sources: ["onboarding.preferred_play_time", "lifetime.accuracy_pct", "streaks.win"],
        eval: function (facts, profile) {
          if (!facts.onboarding.preferred_play_time || facts.lifetime.questions_answered < 10) return null;
          var stat = facts.streaks.win >= 2
            ? ("You're on a " + facts.streaks.win + "-quiz win streak")
            : ("Lifetime accuracy: " + facts.lifetime.accuracy_pct + "%");
          return {
            wow_id: "wow.e.morning_greeting", tier: "E",
            vars: { bucket: facts.onboarding.preferred_play_time, first_name: firstName(facts), stat: stat },
            score: 0,
            signal: "user-set preferred_play_time + stored counters (ambient)"
          };
        }
      })
    ];
  }

  // Deterministic template rendering — server fills every {var} from the
  // candidate's vars map. Anything unfilled stays visibly "{name}" so QA
  // catches a missing fact instead of a hallucinated one being invented.
  export function renderCopy(template: string, vars: { [k: string]: any }): string {
    var out = template;
    var keys = Object.keys(vars || {}).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      var raw = vars[keys[i]];
      var val = ("" + raw).replace(/\{/g, "(").replace(/\}/g, ")");
      var token = "{" + keys[i] + "}";
      while (out.indexOf(token) >= 0) out = out.replace(token, val);
    }
    return out;
  }
}
