'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { parseMoodleXml, generateMoodleXml } = require('../src/converters/moodle-xml');
const { parseQtiZip, generateQtiZip } = require('../src/converters/qti');
const { buildQtiFixture } = require('./fixtures/make-qti-fixture');

const FIXTURES = path.join(__dirname, 'fixtures');
// Workstream A also produces shared fixtures; use them when present.
const SHARED_FIXTURES = process.env.LMS_REAL_FIXTURE_DIR
  ? path.resolve(process.env.LMS_REAL_FIXTURE_DIR)
  : path.join(__dirname, '..', '..', '..', '.lms-dev', 'fixtures');

// ---------------------------------------------------------------------------
// (a) Moodle XML → canonical
// ---------------------------------------------------------------------------

test('Moodle XML import: multichoice single-answer questions parse to canonical shape', () => {
  const xml = fs.readFileSync(path.join(FIXTURES, 'moodle_sample.xml'), 'utf8');
  const { title, questions, fidelity } = parseMoodleXml(xml);

  assert.equal(title, 'Photosynthesis Basics');
  assert.equal(questions.length, 3);

  const q1 = questions[0];
  assert.equal(q1.text, 'Where in the plant cell does photosynthesis primarily occur?');
  assert.deepEqual(q1.options, ['Mitochondria', 'Chloroplasts', 'Nucleus', 'Ribosomes']);
  assert.equal(q1.correct_index, 1);
  assert.match(q1.explanation, /Chloroplasts contain chlorophyll/);

  const q2 = questions[1];
  assert.equal(q2.text, 'Which gas is released during photosynthesis?');
  assert.equal(q2.correct_index, 0);
  assert.equal(q2.explanation, undefined);
});

test('Moodle XML import: fidelity report flags skips and image loss', () => {
  const xml = fs.readFileSync(path.join(FIXTURES, 'moodle_sample.xml'), 'utf8');
  const { fidelity } = parseMoodleXml(xml);

  assert.equal(fidelity.total, 5);
  assert.equal(fidelity.imported + fidelity.imported_with_loss, 3);
  assert.equal(fidelity.skipped, 2);

  const multi = fidelity.items.find((i) => i.name === 'Multi-answer (should skip)');
  assert.equal(multi.status, 'skipped');
  const tf = fidelity.items.find((i) => i.name === 'TF (should skip)');
  assert.equal(tf.status, 'skipped');
  assert.match(tf.notes[0], /unsupported question type "truefalse"/);

  const img = fidelity.items.find((i) => i.name === 'Image question (loss note)');
  assert.equal(img.status, 'imported_with_loss');
  assert.ok(img.notes.some((n) => /image/.test(n)), 'image loss must be noted');
});

test('Moodle XML import: rejects non-quiz XML', () => {
  assert.throws(() => parseMoodleXml('<html><body>nope</body></html>'), /missing <quiz> root/);
});

// ---------------------------------------------------------------------------
// (b) Canvas QTI 1.2 zip → canonical
// ---------------------------------------------------------------------------

test('QTI zip import: manifest-resolved items parse to canonical shape', () => {
  const { title, questions, fidelity } = parseQtiZip(buildQtiFixture());

  assert.equal(title, 'World Capitals Quiz');
  assert.equal(questions.length, 2);

  const q1 = questions[0];
  assert.equal(q1.text, 'What is the capital of France?');
  assert.deepEqual(q1.options, ['London', 'Paris', 'Berlin', 'Madrid']);
  assert.equal(q1.correct_index, 1);
  assert.equal(q1.explanation, 'Paris has been the capital since 987 AD.');

  const q2 = questions[1];
  assert.equal(q2.correct_index, 2);

  assert.equal(fidelity.total, 4);
  assert.equal(fidelity.skipped, 2);
  const essay = fidelity.items.find((i) => i.name === 'Essay item (skip)');
  assert.equal(essay.status, 'skipped');
});

test('QTI zip import: rejects zip without any QTI XML', () => {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addFile('readme.txt', Buffer.from('hi'));
  assert.throws(() => parseQtiZip(zip.toBuffer()), /No imsmanifest\.xml/);
});

// ---------------------------------------------------------------------------
// (c) canonical → Moodle XML (round trip)
// ---------------------------------------------------------------------------

const CANONICAL_PACK = {
  pack_id: 'pack_demo',
  title: 'Solar System <Basics> & More',
  questions: [
    {
      question_id: 'q_planets',
      text: 'Which planet is known as the "Red Planet"?',
      options: ['Venus', 'Mars', 'Jupiter'],
      correct_index: 1,
      explanation: 'Iron oxide on the surface gives Mars its color.',
    },
    {
      question_id: 'q_moons',
      text: 'Which planet has the most moons (as of 2026)?',
      options: ['Earth', 'Saturn', 'Mercury', 'Mars'],
      correct_index: 1,
    },
  ],
};

test('canonical → Moodle XML round-trips through the importer', () => {
  const xml = generateMoodleXml(CANONICAL_PACK);
  assert.match(xml, /<question type="multichoice">/);
  assert.match(xml, /fraction="100"/);

  const { questions, fidelity } = parseMoodleXml(xml);
  assert.equal(questions.length, 2);
  assert.equal(fidelity.skipped, 0);
  assert.equal(questions[0].text, CANONICAL_PACK.questions[0].text);
  assert.deepEqual(questions[0].options, CANONICAL_PACK.questions[0].options);
  assert.equal(questions[0].correct_index, 1);
  assert.equal(questions[0].explanation, CANONICAL_PACK.questions[0].explanation);
  assert.equal(questions[1].correct_index, 1);
  assert.equal(questions[1].explanation, undefined);
});

// ---------------------------------------------------------------------------
// (d) canonical → QTI 1.2 zip (round trip)
// ---------------------------------------------------------------------------

test('canonical → QTI zip round-trips through the importer', () => {
  const zipBuf = generateQtiZip(CANONICAL_PACK);

  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipBuf);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes('imsmanifest.xml'), 'zip must include imsmanifest.xml');

  const { title, questions, fidelity } = parseQtiZip(zipBuf);
  assert.equal(title, 'Solar System <Basics> & More');
  assert.equal(questions.length, 2);
  assert.equal(fidelity.skipped, 0);
  assert.equal(questions[0].text, CANONICAL_PACK.questions[0].text);
  assert.deepEqual(questions[0].options, CANONICAL_PACK.questions[0].options);
  assert.equal(questions[0].correct_index, 1);
  assert.equal(questions[0].explanation, CANONICAL_PACK.questions[0].explanation);
});

// ---------------------------------------------------------------------------
// Shared fixtures from Workstream A (.lms-dev/fixtures) — run when present
// ---------------------------------------------------------------------------

const sharedMoodle = path.join(SHARED_FIXTURES, 'moodle_quiz_export.xml');
test('shared fixture: .lms-dev/fixtures/moodle_quiz_export.xml', { skip: !fs.existsSync(sharedMoodle) }, () => {
  const { questions, fidelity } = parseMoodleXml(fs.readFileSync(sharedMoodle, 'utf8'));
  assert.ok(fidelity.total > 0, 'fixture should contain questions');
  for (const q of questions) {
    assert.ok(q.question_id && q.text && Array.isArray(q.options));
    assert.ok(q.correct_index >= 0 && q.correct_index < q.options.length);
  }
});

const sharedQti = path.join(SHARED_FIXTURES, 'canvas_qti_sample.zip');
test('shared fixture: .lms-dev/fixtures/canvas_qti_sample.zip', { skip: !fs.existsSync(sharedQti) }, () => {
  const { questions, fidelity } = parseQtiZip(fs.readFileSync(sharedQti));
  assert.ok(fidelity.total > 0, 'fixture should contain items');
  for (const q of questions) {
    assert.ok(q.question_id && q.text && Array.isArray(q.options));
    assert.ok(q.correct_index >= 0 && q.correct_index < q.options.length);
  }
});
