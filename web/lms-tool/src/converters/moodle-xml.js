'use strict';

const { XMLParser } = require('fast-xml-parser');
const { stripHtml, escapeXml, createFidelityReport, asArray } = require('./canonical');
const { makeMediaAsset, assertTotalMediaSize, imageRefsFromHtml } = require('./media');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // keep values as strings; "true"/numbers must not be coerced ("100" fractions kept comparable)
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** Moodle wraps most values in <text>; nodes may be plain strings or objects. */
function nodeText(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node['#text'] !== undefined) return String(node['#text']);
  if (node.text !== undefined) return nodeText(node.text);
  return '';
}

function decodeBase64File(file, context) {
  const encoding = String(file['@_encoding'] || 'base64').toLowerCase();
  if (encoding !== 'base64') throw new Error(`${context}: unsupported file encoding "${encoding}"`);
  const encoded = nodeText(file).replace(/\s+/g, '');
  if (!encoded || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(`${context}: invalid base64 attachment`);
  }
  return makeMediaAsset(
    Buffer.from(encoded, 'base64'),
    file['@_name'],
    file['@_mime'] || file['@_mimetype'],
    `moodle:${file['@_name'] || 'attachment'}`
  );
}

function htmlValue(node) {
  return nodeText(node);
}

/**
 * Moodle XML → canonical questions.
 * Scope (per plan): <question type="multichoice"> with a single answer at fraction=100.
 * Everything else is recorded as skipped in the fidelity report.
 *
 * @param {string} xmlString
 * @param {object} [opts] { title }
 * @returns {{ title: string, questions: object[], fidelity: object }}
 */
function parseMoodleXml(xmlString, opts = {}) {
  const fid = createFidelityReport('moodle_xml');
  fid.setSource(opts.source || {});
  let doc;
  try {
    doc = parser.parse(xmlString);
  } catch (err) {
    throw new Error('Moodle XML parse error: ' + err.message);
  }
  if (!doc || !doc.quiz) throw new Error('Not a Moodle XML quiz export: missing <quiz> root');

  const questions = [];
  const mediaById = new Map();
  let title = opts.title || '';
  let idx = 0;

  for (const q of asArray(doc.quiz.question)) {
    const type = q['@_type'] || 'unknown';
    const name = nodeText(q.name) || `question_${idx + 1}`;

    if (type === 'category') {
      // Category path often doubles as the quiz title context
      const cat = nodeText(q.category);
      if (cat && !title) title = cat.split('/').pop().trim();
      continue;
    }

    idx += 1;

    if (type !== 'multichoice') {
      fid.record(name, 'skipped', [`unsupported question type "${type}" (v1 supports multichoice single-answer only)`]);
      continue;
    }

    const notes = [];
    const single = nodeText(q.single).toLowerCase();
    if (single === 'false' || single === '0') {
      fid.record(name, 'skipped', ['multi-answer multichoice (single=false) not supported in v1']);
      continue;
    }

    const questionHtml = htmlValue(q.questiontext);
    const qtext = stripHtml(questionHtml);
    const imageIds = [];
    const files = [...asArray(q.file), ...asArray((q.questiontext || {}).file)];
    for (const file of files) {
      try {
        const asset = decodeBase64File(file, name);
        mediaById.set(asset.media_id, asset);
        imageIds.push(asset.media_id);
      } catch (err) {
        notes.push(err.message);
      }
    }
    const htmlRefs = imageRefsFromHtml(questionHtml);
    if (qtext.hadImages && imageIds.length === 0) {
      notes.push('question image reference had no valid embedded file');
    }
    if (htmlRefs.length > imageIds.length) {
      notes.push(`${htmlRefs.length - imageIds.length} question image reference(s) could not be resolved`);
    }

    const options = [];
    const optionHtml = [];
    const answerFeedback = [];
    let correctIndex = -1;
    let correctCount = 0;
    for (const a of asArray(q.answer)) {
      const rawOption = htmlValue(a);
      const optResult = stripHtml(rawOption);
      if (optResult.hadImages) notes.push(`option ${options.length + 1}: image reference is not supported`);
      const fraction = parseFloat(a['@_fraction'] !== undefined ? a['@_fraction'] : '0');
      if (fraction === 100) {
        correctIndex = options.length;
        correctCount += 1;
      } else if (fraction > 0) {
        notes.push(`option "${optResult.text.slice(0, 40)}" had partial credit (${fraction}%) — treated as incorrect`);
      }
      options.push(optResult.text);
      optionHtml.push(rawOption);
      answerFeedback.push(htmlValue(a.feedback));
    }

    if (options.length < 2) {
      fid.record(name, 'skipped', ['fewer than 2 answer options']);
      continue;
    }
    if (correctCount !== 1) {
      fid.record(name, 'skipped', [`expected exactly one answer with fraction=100, found ${correctCount}`]);
      continue;
    }

    const question = {
      question_id: `mxml_${String(idx).padStart(3, '0')}`,
      title: name,
      text: qtext.text,
      text_html: questionHtml,
      options,
      option_html: optionHtml,
      correct_index: correctIndex,
      question_type: 'multiple_choice',
      points: parseFloat(nodeText(q.defaultgrade) || '1') || 1,
      shuffle: !/^(false|0)$/i.test(nodeText(q.shuffleanswers) || 'true'),
      answer_feedback: answerFeedback,
      image_ids: imageIds,
    };
    const explanationHtml = htmlValue(q.generalfeedback);
    const explanation = stripHtml(explanationHtml).text;
    if (explanation) question.explanation = explanation;
    if (explanationHtml) question.explanation_html = explanationHtml;
    const correctFeedback = htmlValue(q.correctfeedback);
    const incorrectFeedback = htmlValue(q.incorrectfeedback);
    if (correctFeedback) question.feedback_correct = stripHtml(correctFeedback).text;
    if (incorrectFeedback) question.feedback_incorrect = stripHtml(incorrectFeedback).text;

    questions.push(question);
    fid.record(name, notes.length > 0 ? 'imported_with_loss' : 'imported', notes, {
      source_id: nodeText(q.idnumber) || null,
      fields_dropped: notes.map((note) => /image/i.test(note) ? 'images' : 'unknown'),
    });
  }

  const media = Array.from(mediaById.values());
  assertTotalMediaSize(media);
  return { title: title || 'Imported Moodle quiz', questions, media, fidelity: fid.report };
}

/**
 * Canonical pack → Moodle XML (multichoice, single answer).
 * @param {{ title?: string, questions: object[] }} pack
 * @returns {string} XML document
 */
function generateMoodleXml(pack) {
  const mediaById = new Map((pack.media || []).map((asset) => [asset.media_id, asset]));
  const exportName = (asset) => {
    const prefix = `${asset.sha256.slice(0, 12)}-`;
    return asset.filename.startsWith(prefix) ? asset.filename : `${prefix}${asset.filename}`;
  };
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<quiz>');
  lines.push('  <question type="category">');
  lines.push('    <category>');
  lines.push(`      <text>$course$/top/${escapeXml(pack.title || 'QuizVerse export')}</text>`);
  lines.push('    </category>');
  lines.push('  </question>');

  (pack.questions || []).forEach((q, i) => {
    lines.push('  <question type="multichoice">');
    lines.push(`    <name><text>${escapeXml(q.title || q.question_id || `Q${i + 1}`)}</text></name>`);
    lines.push('    <questiontext format="html">');
    let questionHtml = q.text_html || `<p>${escapeXml(q.text)}</p>`;
    for (const mediaId of q.image_ids || []) {
      const asset = mediaById.get(mediaId);
      if (!asset) continue;
      const packagedName = exportName(asset);
      const pluginRef = `@@PLUGINFILE@@/${packagedName}`;
      const imageSrc = new RegExp(`(\\bsrc\\s*=\\s*["'])[^"']*${asset.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(["'])`, 'i');
      if (imageSrc.test(questionHtml)) questionHtml = questionHtml.replace(imageSrc, `$1${pluginRef}$2`);
      else questionHtml += `<p><img src="${escapeXml(pluginRef)}" alt=""></p>`;
    }
    lines.push(`      <text><![CDATA[${questionHtml.replace(/\]\]>/g, ']]&gt;')}]]></text>`);
    for (const mediaId of q.image_ids || []) {
      const asset = mediaById.get(mediaId);
      if (!asset || !asset.data_base64) continue;
      lines.push(`      <file name="${escapeXml(exportName(asset))}" path="/" encoding="base64">${asset.data_base64}</file>`);
    }
    lines.push('    </questiontext>');
    if (q.explanation) {
      lines.push('    <generalfeedback format="html">');
      lines.push(`      <text><![CDATA[${(q.explanation_html || `<p>${escapeXml(q.explanation)}</p>`).replace(/\]\]>/g, ']]&gt;')}]]></text>`);
      lines.push('    </generalfeedback>');
    }
    lines.push(`    <defaultgrade>${Number.isFinite(Number(q.points)) ? Number(q.points) : 1}</defaultgrade>`);
    lines.push('    <penalty>0</penalty>');
    lines.push('    <hidden>0</hidden>');
    lines.push('    <single>true</single>');
    lines.push(`    <shuffleanswers>${q.shuffle === false ? 'false' : 'true'}</shuffleanswers>`);
    lines.push('    <answernumbering>abc</answernumbering>');
    (q.options || []).forEach((opt, oi) => {
      const fraction = oi === q.correct_index ? '100' : '0';
      lines.push(`    <answer fraction="${fraction}" format="html">`);
      const optHtml = (q.option_html && q.option_html[oi]) || `<p>${escapeXml(opt)}</p>`;
      lines.push(`      <text><![CDATA[${optHtml.replace(/\]\]>/g, ']]&gt;')}]]></text>`);
      if (q.answer_feedback && q.answer_feedback[oi]) {
        lines.push(`      <feedback format="html"><text><![CDATA[${String(q.answer_feedback[oi]).replace(/\]\]>/g, ']]&gt;')}]]></text></feedback>`);
      }
      lines.push('    </answer>');
    });
    lines.push('  </question>');
  });

  lines.push('</quiz>');
  return lines.join('\n');
}

module.exports = { parseMoodleXml, generateMoodleXml };
