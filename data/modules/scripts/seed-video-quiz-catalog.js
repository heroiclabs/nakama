#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * seed-video-quiz-catalog.js
 *
 * Build-time generator: reads Unity FallbackQuestions_{lang}.csv files,
 * extracts video rows, and writes build/video_quiz_catalog.json for
 * Nakama postbuild embed (globalThis.__QV_VIDEO_QUIZ_CATALOG__).
 *
 * Usage
 * -----
 *   node scripts/seed-video-quiz-catalog.js
 *   npm run build   # runs automatically after tsc
 *
 * Environment
 * -----------
 *   QV_VIDEO_CSV_ROOT  Path to FallBackQuestionCSV/ (default: sibling Unity repo)
 *   QV_CDN_BASE        CDN base for media.url (default: S3 assets prefix)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(MODULES_DIR, 'build');
const OUTPUT_FILE = path.join(BUILD_DIR, 'video_quiz_catalog.json');

const DEFAULT_CDN_BASE =
  'https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/assets';

// #QVVBS-CACHE (2026-07): the old default pointed at a sibling-repo path
// (Int-newFolder/intelliverse-x-games-platform-2/...) that no longer exists (the
// Unity repo now lives at a completely different location, and is never checked out
// alongside this repo in the production Docker build anyway — Dockerfile.production
// only COPYs data/modules/). That made this script fail with "CSV root not found"
// on every real build, so build/video_quiz_catalog.json was never generated, so
// postbuild.js never embedded __QV_VIDEO_QUIZ_CATALOG__, so qv_catalog_video_quiz
// stayed permanently empty in production ("Video Quiz — Issue observed",
// catalog_bundle_missing). Fix: commit a copy of the CSVs into THIS repo
// (data/modules/assets/video_quiz_csv/) so the build is self-contained and works
// identically in local dev, CI, and the Docker build context.
const DEFAULT_CSV_ROOT = path.join(MODULES_DIR, 'assets', 'video_quiz_csv');

const OPTION_IDS = ['A', 'B', 'C', 'D'];

function parseCsvLine(line) {
  const fields = [];
  let inQuotes = false;
  let current = '';

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else if (c !== '\r') {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

function getField(fields, idx, fallback) {
  if (idx < 0 || idx >= fields.length) return fallback !== undefined ? fallback : '';
  const v = fields[idx];
  return v === undefined || v === null ? (fallback !== undefined ? fallback : '') : String(v).trim();
}

function resolveCsvRoot() {
  const envRoot = process.env.QV_VIDEO_CSV_ROOT;
  if (envRoot) {
    return path.isAbsolute(envRoot) ? envRoot : path.resolve(MODULES_DIR, envRoot);
  }
  return DEFAULT_CSV_ROOT;
}

function resolveCdnBase() {
  const base = (process.env.QV_CDN_BASE || DEFAULT_CDN_BASE).replace(/\/+$/, '');
  return base;
}

function buildHeaderIndex(headerFields) {
  const idx = {
    qidIdx: -1,
    typeIdx: -1,
    folderIdx: -1,
    qTextIdx: -1,
    opt1Idx: -1,
    opt2Idx: -1,
    opt3Idx: -1,
    opt4Idx: -1,
    corrIdx: -1,
    explIdx: -1,
  };

  for (let i = 0; i < headerFields.length; i++) {
    const h = headerFields[i].trim().toLowerCase();
    if (h === 'questionid') idx.qidIdx = i;
    else if (h === 'questiontype') idx.typeIdx = i;
    else if (h === 'foldername') idx.folderIdx = i;
    else if (h === 'question') idx.qTextIdx = i;
    else if (h === 'option1') idx.opt1Idx = i;
    else if (h === 'option2') idx.opt2Idx = i;
    else if (h === 'option3') idx.opt3Idx = i;
    else if (h === 'option4') idx.opt4Idx = i;
    else if (h === 'correctindex') idx.corrIdx = i;
    else if (h === 'explanation') idx.explIdx = i;
  }

  return idx;
}

function correctIndexToOptionIds(correctIndexStr) {
  const ids = [];
  const parts = correctIndexStr.split('|');
  for (let i = 0; i < parts.length; i++) {
    const n = parseInt(parts[i].trim(), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 4) {
      ids.push(OPTION_IDS[n - 1]);
    }
  }
  return ids;
}

function mapVideoRow(fields, header, cdnBase) {
  const questionType = getField(fields, header.typeIdx, '').toLowerCase();
  if (questionType !== 'video') return null;

  const questionId = getField(fields, header.qidIdx);
  const folderName = getField(fields, header.folderIdx);
  const questionText = getField(fields, header.qTextIdx);
  const optionTexts = [
    getField(fields, header.opt1Idx),
    getField(fields, header.opt2Idx),
    getField(fields, header.opt3Idx),
    getField(fields, header.opt4Idx),
  ];

  if (!questionId || !folderName || !questionText) return null;

  const options = [];
  for (let oi = 0; oi < optionTexts.length; oi++) {
    if (optionTexts[oi]) {
      options.push({ id: OPTION_IDS[oi], text: optionTexts[oi] });
    }
  }
  if (options.length < 2) return null;

  const correctIndexStr = getField(fields, header.corrIdx, '0');
  const correctOptionIds = correctIndexToOptionIds(correctIndexStr);
  if (correctOptionIds.length === 0) return null;

  const mediaUrl = cdnBase + '/video/' + folderName + '/01.mp4';

  return {
    id: questionId,
    question_text: questionText,
    options: options,
    correct_option_ids: correctOptionIds,
    has_media: true,
    media: {
      type: 'video',
      url: mediaUrl,
      thumbnail_url: null,
      duration_seconds: null,
      mime_type: 'video/mp4',
    },
    explanation: getField(fields, header.explIdx, ''),
    difficulty: 'medium',
  };
}

function parseVideoQuestionsFromCsv(csvPath, cdnBase) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter(function (line) {
    return line.trim().length > 0;
  });
  if (lines.length < 2) return [];

  const headerFields = parseCsvLine(lines[0]);
  const header = buildHeaderIndex(headerFields);
  if (header.typeIdx === -1 || header.folderIdx === -1) {
    console.warn('[seed-video-quiz-catalog] Missing QuestionType/FolderName columns in ' + csvPath);
    return [];
  }

  const questions = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 9) continue;
    const entry = mapVideoRow(fields, header, cdnBase);
    if (entry) questions.push(entry);
  }
  return questions;
}

function discoverLangCsvFiles(csvRoot) {
  if (!fs.existsSync(csvRoot)) return [];

  return fs
    .readdirSync(csvRoot)
    .filter(function (name) {
      return /^FallbackQuestions_([a-z]{2})\.csv$/i.test(name);
    })
    .map(function (name) {
      const match = name.match(/^FallbackQuestions_([a-z]{2})\.csv$/i);
      return { lang: match[1].toLowerCase(), path: path.join(csvRoot, name) };
    })
    .sort(function (a, b) {
      return a.lang.localeCompare(b.lang);
    });
}

function main() {
  const csvRoot = resolveCsvRoot();
  const cdnBase = resolveCdnBase();

  console.log('[seed-video-quiz-catalog] CSV root: ' + csvRoot);
  console.log('[seed-video-quiz-catalog] CDN base:  ' + cdnBase);

  if (!fs.existsSync(csvRoot)) {
    console.error(
      '[seed-video-quiz-catalog] ERROR: CSV root not found. Set QV_VIDEO_CSV_ROOT to FallBackQuestionCSV/.',
    );
    process.exit(2);
  }

  const langFiles = discoverLangCsvFiles(csvRoot);
  if (langFiles.length === 0) {
    console.error('[seed-video-quiz-catalog] ERROR: No FallbackQuestions_{lang}.csv files found.');
    process.exit(2);
  }

  const langs = {};
  for (let li = 0; li < langFiles.length; li++) {
    const lf = langFiles[li];
    const questions = parseVideoQuestionsFromCsv(lf.path, cdnBase);
    if (questions.length > 0) {
      langs[lf.lang] = questions;
    }
    console.log(
      '[seed-video-quiz-catalog] ' +
        lf.lang +
        ': ' +
        questions.length +
        ' video question(s) from ' +
        path.basename(lf.path),
    );
  }

  const enCount = langs.en ? langs.en.length : 0;
  if (enCount === 0) {
    console.error(
      '[seed-video-quiz-catalog] ERROR: zero video rows found for lang=en — build aborted.',
    );
    process.exit(1);
  }

  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  const catalog = {
    version: new Date().toISOString(),
    source: 'FallbackQuestions_csv',
    langs: langs,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(
    '[seed-video-quiz-catalog] Wrote ' +
      OUTPUT_FILE +
      ' (' +
      enCount +
      ' en, ' +
      Object.keys(langs).length +
      ' lang(s) total)',
  );
}

main();
