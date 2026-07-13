'use strict';

// Local pack cache. Source of truth in production is Nakama's quizverse_packs
// (via lms_import_pack); this mirror keeps the picker and the player (and the
// mock grader) working even while Workstream B's RPCs are not live yet.

const fs = require('fs');
const path = require('path');
const { PACK_STORE_PATH } = require('./config');

const DEMO_PACK = {
  pack_id: 'pack_demo_solar',
  title: 'Solar System Basics (demo pack)',
  source: { kind: 'builtin' },
  questions: [
    {
      question_id: 'q_red_planet',
      text: 'Which planet is known as the Red Planet?',
      options: ['Venus', 'Mars', 'Jupiter', 'Mercury'],
      correct_index: 1,
      explanation: 'Iron oxide (rust) on the surface gives Mars its reddish color.',
    },
    {
      question_id: 'q_largest',
      text: 'Which is the largest planet in the Solar System?',
      options: ['Earth', 'Saturn', 'Jupiter', 'Neptune'],
      correct_index: 2,
      explanation: 'Jupiter is more than twice as massive as all other planets combined.',
    },
    {
      question_id: 'q_sun',
      text: 'What is the Sun mostly made of?',
      options: ['Molten rock', 'Hydrogen and helium', 'Oxygen and carbon', 'Iron'],
      correct_index: 1,
      explanation: 'The Sun is roughly 74% hydrogen and 24% helium by mass.',
    },
  ],
};

function load() {
  try {
    return JSON.parse(fs.readFileSync(PACK_STORE_PATH, 'utf8'));
  } catch {
    return { packs: { [DEMO_PACK.pack_id]: DEMO_PACK } };
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(PACK_STORE_PATH), { recursive: true });
  fs.writeFileSync(PACK_STORE_PATH, JSON.stringify(state, null, 2));
}

function listPacks() {
  const state = load();
  return Object.values(state.packs).map((p) => ({
    pack_id: p.pack_id,
    title: p.title,
    question_count: p.questions.length,
    source: p.source || {},
  }));
}

function getPack(packId) {
  return load().packs[packId] || null;
}

function upsertPack(pack) {
  const state = load();
  state.packs[pack.pack_id] = pack;
  save(state);
  return pack;
}

module.exports = { listPacks, getPack, upsertPack, DEMO_PACK };
