'use strict';

/**
 * Tiny local stub of the Workstream-B lms-bridge RPC contract.
 * Used two ways:
 *   1. in-process fallback by src/nakama-client.js when real RPCs aren't live
 *   2. standalone HTTP stub via mock-nakama/server.js (mimics /v2/rpc/*)
 * Grading here mirrors the contract shape only; production grading is
 * server-side in Nakama (quiz_submit_result_v2 semantics).
 */

const crypto = require('crypto');
const packStore = require('../src/pack-store');

// volatile in-memory state; fine for a stub
const bindings = {}; // `${platform_id}|${deployment_id}|${resource_link_id}` -> { pack_id, score_maximum }
const linkStatus = {}; // same key (+ optional |sub) -> status record

function bindingKey(p) {
  return [p.platform_id, p.deployment_id, p.resource_link_id || (p.resource_link && p.resource_link.id) || ''].join('|');
}

const handlers = {
  lms_launch_session(p) {
    const idHash = crypto.createHash('sha256')
      .update(`${p.platform_id}|${p.deployment_id}|${p.sub}`)
      .digest('hex')
      .slice(0, 16);
    const bound = bindings[bindingKey(p)];
    return {
      user_id: `mockuser_${idHash}`,
      session_token: `mocksession_${crypto.randomBytes(12).toString('hex')}`,
      pack_id: (bound && bound.pack_id) || null,
    };
  },

  lms_deeplink_bind(p) {
    bindings[bindingKey(p)] = { pack_id: p.pack_id, score_maximum: p.score_maximum };
    return { ok: true };
  },

  lms_attempt_complete(p) {
    const pack = packStore.getPack(p.pack_id);
    if (!pack) throw new Error(`mock: unknown pack_id ${p.pack_id}`);
    const bound = bindings[bindingKey(p)];
    const scoreMaximum = (bound && bound.score_maximum) || pack.questions.length;

    let correct = 0;
    const breakdown = pack.questions.map((q) => {
      const ans = (p.answers || []).find((a) => a.question_id === q.question_id);
      const selected = ans ? ans.selected_index : -1;
      const isCorrect = selected === q.correct_index;
      if (isCorrect) correct += 1;
      return {
        question_id: q.question_id,
        selected_index: selected,
        correct_index: q.correct_index,
        correct: isCorrect,
        explanation: q.explanation || null,
      };
    });

    const scoreGiven = pack.questions.length > 0
      ? Math.round((correct / pack.questions.length) * scoreMaximum * 100) / 100
      : 0;

    linkStatus[bindingKey(p) + '|' + p.sub] = {
      last_attempt_at: new Date().toISOString(),
      score_given: scoreGiven,
      score_maximum: scoreMaximum,
      grade_sync: 'pending',
    };
    return { score_given: scoreGiven, score_maximum: scoreMaximum, breakdown };
  },

  lms_import_pack(p) {
    const questions = p.questions || [];
    packStore.upsertPack({
      pack_id: p.pack_id,
      title: p.title || p.pack_id,
      questions,
      source: p.source || {},
    });
    return { imported_count: questions.length, skipped: [] };
  },

  lms_link_status(p) {
    const key = bindingKey(p) + (p.sub ? '|' + p.sub : '');
    if (p.grade_sync) {
      // tool-side AGS result being recorded back
      linkStatus[key] = { ...(linkStatus[key] || {}), ...p.status_patch, grade_sync: p.grade_sync };
      return { ok: true };
    }
    return linkStatus[key] || { grade_sync: 'unknown' };
  },

  lms_platform_upsert(p) {
    return { ok: true, platform_id: p.platform_id };
  },

  lms_platform_list() {
    return { platforms: [] };
  },
};

function handle(id, payload) {
  const fn = handlers[id];
  if (!fn) throw new Error(`mock-nakama: no handler for RPC ${id}`);
  return Promise.resolve(fn(payload));
}

module.exports = { handle, handlers };
