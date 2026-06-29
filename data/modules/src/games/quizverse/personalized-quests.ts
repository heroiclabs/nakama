// Personalized Quest Engine — wires Player DNA to the Quest config pool.
//
// Single RPC:  quizverse_get_personalized_quests
//
// HOW IT WORKS
// ─────────────
// The quest admin still manages the pool via quest_engine_admin_save_config.
// Each quest config may carry DNA filter/routing tags in additionalProperties:
//
//   dna_topic         — topic slug this quest targets ("anime", "pokemon", …)
//   dna_slot          — "confidence"|"growth"|"discovery"|"review"|"any"
//                       Maps to the Mix Algorithm slot this quest fills.
//   dna_min_affinity  — float (0–1): minimum affinity to show this quest.
//                       e.g. "0.5" = only show to players who actively like this topic.
//   dna_max_mastery   — float (0–1): hide once player exceeds this mastery level.
//                       e.g. "0.85" = don't assign a "beginner" quest to experts.
//   dna_min_elo       — int: minimum Elo required (challenge quests).
//   dna_max_elo       — int: maximum Elo allowed (novice-friendly quests).
//   dna_template      — "true": quest name/steps use __topic__ placeholder.
//   dna_template_slot — "top1"|"top2"|"weak1": which DNA slot resolves __topic__.
//
// TEMPLATE QUESTS
// ───────────────
// With dna_template="true", a single quest config becomes many personalised
// quests — one per player, resolved from their DNA at request time.
//
// Example quest config stored in qv_quest_config:
//   {
//     "id":   "confidence_topic_daily",
//     "name": "Play 3 rounds of __topic__",
//     "category": "daily",
//     "repeatable": true,
//     "steps": [{
//       "id": "s1", "eventType": "quiz_completed", "requiredCount": 3,
//       "filterField": "topic", "filterValue": "__dna_topic__"
//     }],
//     "additionalProperties": {
//       "dna_slot":          "confidence",
//       "dna_template":      "true",
//       "dna_template_slot": "top1",
//       "dna_min_affinity":  "0.4"
//     }
//   }
//
// For a player whose top topic is "anime", this resolves to:
//   id:   "confidence_topic_daily_anime"
//   name: "Play 3 rounds of Anime"
//   step filterValue: "anime"
//
// SLOT PRIORITY (return order)
// ────────────────────────────
//  review      → 100  (SRQ due — highest obligation)
//  confidence  → 80   (top affinity topic — builds momentum)
//  growth      → 60   (weak area — real skill development)
//  discovery   → 40   (undiscovered topic — prevents fatigue)
//  any         → 20   (untagged — generic fallback)

namespace PersonalizedQuests {

  var QUEST_CONFIG_COLLECTION = "qv_quest_config";

  // Re-declare the QuestConfig shape so this namespace is self-contained
  // (avoids cross-namespace TS dependency on QuestEngine internals).
  interface StepConfig {
    id:            string;
    description:   string;
    eventType:     string;
    requiredCount: number;
    requiredValue?: number;
    filterField?:  string;
    filterValue?:  string;
  }

  interface QuestConfig {
    id:                   string;
    name:                 string;
    description?:         string;
    category?:            string;
    steps:                StepConfig[];
    reward?:              any;
    expiresAt?:           number;
    prerequisiteIds?:     string[];
    repeatable?:          boolean;
    resetIntervalSec?:    number;
    additionalProperties?: { [key: string]: string };
  }

  interface QuestsConfig {
    quests: { [questId: string]: QuestConfig };
  }

  // ── DNA filter result ─────────────────────────────────────────────────────────

  interface FilterResult {
    passes:         boolean;
    slot:           string;
    resolvedTopic:  string;
    score:          number;   // 0–100, used for sort
    reason:         string;   // human-readable label for UI
  }

  var SLOT_PRIORITY: { [slot: string]: number } = {
    "review":     100,
    "confidence": 80,
    "growth":     60,
    "discovery":  40,
    "any":        20
  };

  // ── Filter logic ──────────────────────────────────────────────────────────────

  function evaluateDna(quest: QuestConfig, dna: PlayerDNA.DNA): FilterResult {
    var props        = quest.additionalProperties || {};
    var slot         = props["dna_slot"]           || "any";
    var topic        = props["dna_topic"]          || "";
    var minAff       = props["dna_min_affinity"]   ? parseFloat(props["dna_min_affinity"])  : -1;
    var maxMas       = props["dna_max_mastery"]    ? parseFloat(props["dna_max_mastery"])   :  2;
    var minElo       = props["dna_min_elo"]        ? parseInt(props["dna_min_elo"], 10)     : -1;
    var maxElo       = props["dna_max_elo"]        ? parseInt(props["dna_max_elo"], 10)     : 99999;
    var isTemplate   = props["dna_template"]       === "true";
    var tplSlot      = props["dna_template_slot"]  || "top1";

    var resolvedTopic = topic;

    // Resolve template placeholder to actual player topic
    if (isTemplate) {
      var tops  = PlayerDNA.topTopics(dna, 2);
      var weaks = PlayerDNA.weakestTopics(dna, 1);
      if      (tplSlot === "top1"  && tops.length  > 0) resolvedTopic = tops[0];
      else if (tplSlot === "top2"  && tops.length  > 1) resolvedTopic = tops[1];
      else if (tplSlot === "weak1" && weaks.length > 0) resolvedTopic = weaks[0];
      else {
        // Template but no DNA signal yet — skip during cold start
        return { passes: false, slot: slot, resolvedTopic: "", score: 0, reason: "" };
      }
    }

    // Affinity gate
    if (resolvedTopic && minAff >= 0) {
      var aff = dna.affinities[resolvedTopic] || 0;
      if (aff < minAff) {
        return { passes: false, slot: slot, resolvedTopic: resolvedTopic, score: 0, reason: "" };
      }
    }

    // Mastery ceiling — don't give an intro quest to an expert
    if (resolvedTopic && maxMas < 2) {
      var mas = dna.masteries[resolvedTopic] || 0;
      if (mas > maxMas) {
        return { passes: false, slot: slot, resolvedTopic: resolvedTopic, score: 0, reason: "" };
      }
    }

    // Elo window
    if (resolvedTopic && (minElo > 0 || maxElo < 99999)) {
      var elo = dna.elos[resolvedTopic] || 1200;
      if (elo < minElo || elo > maxElo) {
        return { passes: false, slot: slot, resolvedTopic: resolvedTopic, score: 0, reason: "" };
      }
    }

    // Relevance score for ranking within same slot
    var score = 50;
    if (resolvedTopic) {
      var a = dna.affinities[resolvedTopic] || 0;
      var m = dna.masteries[resolvedTopic]  || 0;
      if (slot === "confidence") {
        // High affinity + room to grow = best confidence quest
        score = Math.round(a * 70 + (1 - m) * 30);
      } else if (slot === "growth") {
        // Weak mastery but player has at least some interest (not totally foreign)
        score = Math.round((1 - m) * 60 + a * 40);
      } else if (slot === "discovery") {
        // Inverse of affinity — most unknown topic gets highest score
        score = Math.round((1 - a) * 80 + 20);
      } else if (slot === "review") {
        score = 95;
      }
    }

    return {
      passes:        true,
      slot:          slot,
      resolvedTopic: resolvedTopic,
      score:         score,
      reason:        buildReason(slot, resolvedTopic, dna)
    };
  }

  function buildReason(slot: string, topic: string, dna: PlayerDNA.DNA): string {
    if (!topic) {
      if (slot === "review")     return "Reviews due — don't let them expire!";
      if (slot === "confidence") return "Keep your momentum going.";
      if (slot === "growth")     return "Push your limits today.";
      if (slot === "discovery")  return "Try something new!";
      return "Quest matched to your profile.";
    }
    var label   = topic.charAt(0).toUpperCase() + topic.slice(1);
    var aff     = dna.affinities[topic] || 0;
    var mastery = dna.masteries[topic]  || 0;

    if (slot === "confidence") {
      if (aff > 0.75) return "You love " + label + " — build on your streak!";
      return "You're good at " + label + " (" + Math.round(mastery * 100) + "% mastery). Keep going.";
    }
    if (slot === "growth") {
      return "Level up your " + label + " knowledge. You're at " + Math.round(mastery * 100) + "% mastery.";
    }
    if (slot === "discovery") {
      return "Explore " + label + " — a new topic for you!";
    }
    if (slot === "review") {
      return "Review your " + label + " mistakes from previous sessions.";
    }
    return "Matched to your " + label + " profile (" + Math.round(aff * 100) + "% affinity).";
  }

  // ── Template instantiation ────────────────────────────────────────────────────

  // Replace __topic__ and __dna_topic__ placeholders in text.
  function resolveText(text: string, topic: string): string {
    if (!topic) return text;
    var label = topic.charAt(0).toUpperCase() + topic.slice(1);
    return text
      .replace(/__topic__/g, label)
      .replace(/__dna_topic__/g, topic);
  }

  // Clone a quest and substitute all template placeholders.
  function instantiate(quest: QuestConfig, resolvedTopic: string): QuestConfig {
    var id = resolvedTopic ? quest.id + "_" + resolvedTopic : quest.id;
    var steps: StepConfig[] = [];
    for (var i = 0; i < quest.steps.length; i++) {
      var s = quest.steps[i];
      var filterValue = s.filterValue;
      if (filterValue === "__dna_topic__" && resolvedTopic) {
        filterValue = resolvedTopic;
      }
      steps.push({
        id:            s.id,
        description:   resolveText(s.description, resolvedTopic),
        eventType:     s.eventType,
        requiredCount: s.requiredCount,
        requiredValue: s.requiredValue,
        filterField:   s.filterField,
        filterValue:   filterValue
      });
    }
    return {
      id:                   id,
      name:                 resolveText(quest.name, resolvedTopic),
      description:          quest.description ? resolveText(quest.description, resolvedTopic) : undefined,
      category:             quest.category,
      expiresAt:            quest.expiresAt,
      prerequisiteIds:      quest.prerequisiteIds,
      repeatable:           quest.repeatable,
      resetIntervalSec:     quest.resetIntervalSec,
      reward:               quest.reward,
      additionalProperties: quest.additionalProperties,
      steps:                steps
    };
  }

  // ── RPC ───────────────────────────────────────────────────────────────────────
  // quizverse_get_personalized_quests
  //
  // Request:  { gameId?: string, limit?: number (1–20, default 10) }
  // Response: {
  //   quests: [{
  //     id, name, description, category, steps, expiresAt, repeatable,
  //     personalization: { slot, resolved_topic, reason, relevance_score }
  //   }],
  //   dna_summary: { top_topics, cold_start, total_sessions }
  // }

  function rpcGetPersonalizedQuests(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data   = RpcHelpers.parseRpcPayload(payload);
    var gameId = (data.gameId as string) || Constants.DEFAULT_GAME_ID;
    var limit  = (typeof data.limit === "number") ? Math.min(Math.max(data.limit, 1), 20) : 10;

    // Load Player DNA (returns empty default for new players — cold start path)
    var dna = PlayerDNA.load(nk, userId);

    // Load quest config pool
    var rows: nkruntime.StorageObject[] = [];
    try {
      rows = nk.storageRead([{
        collection: QUEST_CONFIG_COLLECTION,
        key:        gameId,
        userId:     Constants.SYSTEM_USER_ID
      }]);
    } catch (_) {}

    var config: QuestsConfig = { quests: {} };
    if (rows && rows.length > 0 && rows[0].value) {
      config = rows[0].value as QuestsConfig;
    }

    var questIds = Object.keys(config.quests);
    var now      = Math.floor(Date.now() / 1000);

    // ── Phase 1: filter ──────────────────────────────────────────────────────

    var candidates: Array<{ quest: QuestConfig; filter: FilterResult }> = [];

    for (var i = 0; i < questIds.length; i++) {
      var quest = config.quests[questIds[i]];

      if (quest.expiresAt && now > quest.expiresAt) continue;

      var hasDnaProps = quest.additionalProperties && (
        quest.additionalProperties["dna_topic"]    ||
        quest.additionalProperties["dna_slot"]     ||
        quest.additionalProperties["dna_template"]
      );

      if (!hasDnaProps) {
        // Untagged quests always pass through with baseline priority
        candidates.push({
          quest:  quest,
          filter: { passes: true, slot: "any", resolvedTopic: "", score: 40, reason: "" }
        });
        continue;
      }

      var fr = evaluateDna(quest, dna);
      if (!fr.passes) continue;

      candidates.push({ quest: quest, filter: fr });
    }

    // ── Phase 2: sort — slot priority first, then relevance score ────────────

    candidates.sort(function(a, b) {
      var pa = SLOT_PRIORITY[a.filter.slot] || 20;
      var pb = SLOT_PRIORITY[b.filter.slot] || 20;
      if (pb !== pa) return pb - pa;
      return b.filter.score - a.filter.score;
    });

    // ── Phase 3: instantiate templates + build response ──────────────────────

    var out: any[] = [];
    for (var j = 0; j < Math.min(candidates.length, limit); j++) {
      var c    = candidates[j];
      var inst = instantiate(c.quest, c.filter.resolvedTopic);

      var stepsOut: any[] = [];
      for (var s = 0; s < inst.steps.length; s++) {
        var step = inst.steps[s];
        stepsOut.push({
          id:            step.id,
          description:   step.description,
          requiredCount: step.requiredCount,
          filterField:   step.filterField  || null,
          filterValue:   step.filterValue  || null
        });
      }

      out.push({
        id:          inst.id,
        name:        inst.name,
        description: inst.description || null,
        category:    inst.category    || null,
        expiresAt:   inst.expiresAt   || null,
        repeatable:  !!inst.repeatable,
        steps:       stepsOut,
        personalization: {
          slot:            c.filter.slot,
          resolved_topic:  c.filter.resolvedTopic || null,
          reason:          c.filter.reason        || null,
          relevance_score: c.filter.score
        }
      });
    }

    logger.info(
      "[PersonalizedQuests] user=%s game=%s pool=%d returned=%d cold_start=%s top=%s",
      userId, gameId, candidates.length, out.length,
      dna.behavioral.cold_start_done ? "false" : "true",
      PlayerDNA.topTopics(dna, 1).join(",") || "none"
    );

    return RpcHelpers.successResponse({
      quests:      out,
      dna_summary: {
        top_topics:     PlayerDNA.topTopics(dna, 3),
        cold_start:     !dna.behavioral.cold_start_done,
        total_sessions: dna.behavioral.total_sessions
      }
    });
  }

  // postbuild.js autoInvokeRegister requires single-arg register() for pooled VM replay.
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_get_personalized_quests", rpcGetPersonalizedQuests);
  }
}
