'use strict';

const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');
const { stripHtml, escapeXml, createFidelityReport, asArray } = require('./canonical');
const {
  safeArchivePath,
  resolvePackagePath,
  makeMediaAsset,
  assertTotalMediaSize,
  imageRefsFromHtml,
  MAX_TOTAL_MEDIA_BYTES,
} = require('./media');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true, // imsmanifest often carries namespaces
});

function nodeText(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node['#text'] !== undefined) return String(node['#text']);
  return '';
}

function metadataField(item, label) {
  const md = item.itemmetadata && item.itemmetadata.qtimetadata;
  if (!md) return undefined;
  for (const f of asArray(md.qtimetadatafield)) {
    if (nodeText(f.fieldlabel) === label) return nodeText(f.fieldentry);
  }
  return undefined;
}

function materialValue(material) {
  const first = asArray(material)[0] || {};
  return nodeText(asArray(first.mattext)[0]);
}

function materialImageRefs(material) {
  const first = asArray(material)[0] || {};
  const refs = [];
  for (const image of asArray(first.matimage)) {
    const uri = image['@_uri'] || image['@_src'];
    if (uri) refs.push(uri);
  }
  refs.push(...imageRefsFromHtml(materialValue(material)));
  return refs;
}

/** Collect <item> elements from an assessment, recursing through nested <section>s. */
function collectItems(sectionLike, out) {
  for (const section of asArray(sectionLike.section)) collectItems(section, out);
  for (const item of asArray(sectionLike.item)) out.push(item);
  return out;
}

function parseAssessmentXml(xmlString, fid, questions, startIndex, context = {}) {
  const doc = parser.parse(xmlString);
  const root = doc.questestinterop;
  if (!root) return { title: '', nextIndex: startIndex };

  let title = '';
  let idx = startIndex;

  for (const assessment of asArray(root.assessment)) {
    if (!title) title = assessment['@_title'] || '';
    const items = collectItems(assessment, []);
    for (const item of items) {
      idx += 1;
      parseItem(item, fid, questions, idx, context);
    }
  }
  // Standalone objectbank / top-level items (some producers skip <assessment>)
  for (const item of asArray(root.item)) {
    idx += 1;
    parseItem(item, fid, questions, idx, context);
  }
  return { title, nextIndex: idx };
}

function parseItem(item, fid, questions, idx, context) {
  const name = item['@_title'] || item['@_ident'] || `item_${idx}`;
  const qtype = metadataField(item, 'question_type');
  if (qtype && !/^(multiple_choice_question|true_false_question)$/.test(qtype)) {
    fid.record(name, 'skipped', [`unsupported question_type "${qtype}" (v1 supports single-answer multiple choice only)`]);
    return;
  }

  const notes = [];
  const presentation = item.presentation;
  if (!presentation) {
    fid.record(name, 'skipped', ['no <presentation> element']);
    return;
  }

  // Stem: presentation/material/mattext
  const stemRaw = materialValue(presentation.material);
  const stem = stripHtml(stemRaw);
  const imageIds = [];
  for (const ref of materialImageRefs(presentation.material)) {
    const resolved = resolvePackagePath(context.assessmentPath || 'assessment.xml', ref);
    const entry = resolved && context.byName && context.byName.get(resolved);
    if (!entry) {
      notes.push(`question image could not be resolved from package: ${ref}`);
      continue;
    }
    try {
      const asset = makeMediaAsset(entry.getData(), resolved.split('/').pop(), '', resolved);
      context.mediaById.set(asset.media_id, asset);
      imageIds.push(asset.media_id);
    } catch (err) {
      notes.push(err.message);
    }
  }

  // Choices: response_lid/render_choice/response_label
  const responseLid = asArray(presentation.response_lid)[0];
  if (!responseLid) {
    fid.record(name, 'skipped', ['no <response_lid> (not a choice interaction)']);
    return;
  }
  const cardinality = (responseLid['@_rcardinality'] || 'Single').toLowerCase();
  if (cardinality !== 'single') {
    fid.record(name, 'skipped', [`rcardinality="${responseLid['@_rcardinality']}" not supported in v1`]);
    return;
  }
  const respIdent = responseLid['@_ident'];

  const options = [];
  const identToIndex = {};
  const renderChoice = asArray(responseLid.render_choice)[0] || {};
  for (const label of asArray(renderChoice.response_label)) {
    const raw = materialValue(label.material);
    const opt = stripHtml(raw);
    if (materialImageRefs(label.material).length) notes.push(`option ${options.length + 1}: image choices are not supported`);
    identToIndex[String(label['@_ident'])] = options.length;
    options.push(opt.text);
  }
  if (options.length < 2) {
    fid.record(name, 'skipped', ['fewer than 2 answer options']);
    return;
  }

  // Correct answer: respcondition whose setvar (SCORE) == 100 → varequal ident
  let correctIndex = -1;
  let explanation;
  const resprocessing = asArray(item.resprocessing)[0];
  for (const cond of asArray(resprocessing && resprocessing.respcondition)) {
    const setvars = asArray(cond.setvar);
    const isFullCredit = setvars.some((sv) => parseFloat(nodeText(sv)) === 100);
    if (!isFullCredit) continue;
    const conditionvar = asArray(cond.conditionvar)[0] || {};
    for (const ve of asArray(conditionvar.varequal)) {
      if (respIdent && ve['@_respident'] && ve['@_respident'] !== respIdent) continue;
      const ident = String(nodeText(ve));
      if (ident in identToIndex) {
        correctIndex = identToIndex[ident];
        break;
      }
    }
    if (correctIndex >= 0) break;
  }
  if (correctIndex < 0) {
    fid.record(name, 'skipped', ['could not resolve a single correct answer (no respcondition with answer weight 100)']);
    return;
  }

  // General feedback → explanation
  for (const fb of asArray(item.itemfeedback)) {
    const ident = String(fb['@_ident'] || '').toLowerCase();
    if (ident === 'general_fb' || ident === 'general' || ident === 'correct_fb') {
      const flow = asArray(fb.flow_mat)[0] || fb;
      const raw = nodeText(asArray(asArray(flow.material)[0] && asArray(flow.material)[0].mattext)[0]);
      const fbText = stripHtml(raw).text;
      if (fbText) { explanation = fbText; break; }
    }
  }

  const question = {
    question_id: String(item['@_ident'] || `qti_${String(idx).padStart(3, '0')}`),
    title: name,
    text: stem.text,
    text_html: stemRaw,
    options,
    correct_index: correctIndex,
    question_type: 'multiple_choice',
    points: parseFloat(metadataField(item, 'points_possible') || metadataField(item, 'question_points') || '1') || 1,
    shuffle: String((renderChoice && renderChoice['@_shuffle']) || 'No').toLowerCase() === 'yes',
    image_ids: imageIds,
  };
  if (explanation) question.explanation = explanation;
  questions.push(question);
  fid.record(name, notes.length > 0 ? 'imported_with_loss' : 'imported', notes, {
    source_id: item['@_ident'] || null,
    fields_dropped: notes.map((note) => /image/i.test(note) ? 'images' : 'unknown'),
  });
}

/**
 * Canvas QTI 1.2 zip → canonical questions.
 * Resolves assessment files via imsmanifest.xml (manifest-first per plan §13.2);
 * falls back to scanning *.xml files containing <questestinterop> when no manifest exists.
 *
 * @param {Buffer} zipBuffer
 * @returns {{ title: string, questions: object[], fidelity: object }}
 */
function parseQtiZip(zipBuffer, opts = {}) {
  const fid = createFidelityReport('qti_1.2');
  fid.setSource(opts.source || {});
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length > 25 * 1024 * 1024) {
    throw new Error('QTI package exceeds the 25 MiB upload limit');
  }
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  let expandedBytes = 0;
  const byName = new Map();
  for (const entry of entries) {
    const safeName = safeArchivePath(entry.entryName);
    expandedBytes += Number(entry.header && entry.header.size || 0);
    if (expandedBytes > 30 * 1024 * 1024) throw new Error('QTI package expands beyond the 30 MiB safety limit');
    if (byName.has(safeName)) throw new Error(`Duplicate package path: ${safeName}`);
    byName.set(safeName, entry);
  }

  const assessmentFiles = [];
  const manifestEntry = entries.find((e) => /(^|\/)imsmanifest\.xml$/i.test(e.entryName));
  if (manifestEntry) {
    const manifest = parser.parse(manifestEntry.getData().toString('utf8'));
    const resources = manifest.manifest && manifest.manifest.resources;
    for (const res of asArray(resources && resources.resource)) {
      const type = String(res['@_type'] || '');
      if (!/imsqti/i.test(type)) continue;
      const hrefs = [];
      if (res['@_href']) hrefs.push(res['@_href']);
      for (const f of asArray(res.file)) if (f['@_href']) hrefs.push(f['@_href']);
      for (const href of hrefs) {
        const norm = resolvePackagePath(safeArchivePath(manifestEntry.entryName), href);
        if (byName.has(norm) && /\.xml$/i.test(norm) && !assessmentFiles.includes(norm)) {
          assessmentFiles.push(norm);
        }
      }
    }
    if (assessmentFiles.length === 0) {
      throw new Error('imsmanifest.xml contains no resolvable QTI assessment resource');
    }
  } else {
    throw new Error('No imsmanifest.xml found in QTI package');
  }

  const questions = [];
  const mediaById = new Map();
  let title = '';
  let idx = 0;
  for (const file of assessmentFiles) {
    const xml = byName.get(file).getData().toString('utf8');
    const result = parseAssessmentXml(xml, fid, questions, idx, { assessmentPath: file, byName, mediaById });
    idx = result.nextIndex;
    if (!title && result.title) title = result.title;
  }

  const media = Array.from(mediaById.values());
  assertTotalMediaSize(media);
  const unreferencedMedia = entries.filter((e) => /\.(png|jpe?g|gif|svg|webp)$/i.test(e.entryName))
    .filter((e) => !media.some((asset) => asset.source_path === safeArchivePath(e.entryName)));
  if (unreferencedMedia.length) fid.addGlobalNote(`${unreferencedMedia.length} unreferenced media file(s) ignored`);
  return { title: title || 'Imported QTI quiz', questions, media, fidelity: fid.report };
}

/**
 * Canonical pack → Canvas-flavored QTI 1.2 zip (imsmanifest.xml + assessment XML).
 * @param {{ pack_id?: string, title?: string, questions: object[] }} pack
 * @returns {Buffer} zip buffer
 */
function generateQtiZip(pack) {
  const assessmentIdent = (pack.pack_id || 'quizverse_pack').replace(/[^a-zA-Z0-9_-]/g, '_');
  const title = pack.title || 'QuizVerse export';
  const items = [];
  const mediaById = new Map((pack.media || []).map((asset) => [asset.media_id, asset]));
  const usedMedia = new Map();
  const exportName = (asset) => {
    const prefix = `${asset.sha256.slice(0, 12)}-`;
    return asset.filename.startsWith(prefix) ? asset.filename : `${prefix}${asset.filename}`;
  };

  (pack.questions || []).forEach((q, i) => {
    const itemIdent = String(q.question_id || `${assessmentIdent}_item_${i + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const respIdent = 'response1';
    const labels = (q.options || [])
      .map((opt, oi) => [
        `            <response_label ident="${itemIdent}_a${oi}">`,
        '              <material>',
        `                <mattext texttype="text/plain">${escapeXml(opt)}</mattext>`,
        '              </material>',
        '            </response_label>',
      ].join('\n'))
      .join('\n');

    const feedback = q.explanation
      ? [
        '      <itemfeedback ident="general_fb">',
        '        <flow_mat>',
        '          <material>',
        `            <mattext texttype="text/plain">${escapeXml(q.explanation)}</mattext>`,
        '          </material>',
        '        </flow_mat>',
        '      </itemfeedback>',
      ].join('\n')
      : '';

    let stemHtml = q.text_html || `<p>${escapeXml(q.text)}</p>`;
    for (const mediaId of q.image_ids || []) {
      const asset = mediaById.get(mediaId);
      if (!asset) continue;
      usedMedia.set(mediaId, asset);
      const relative = `media/${exportName(asset)}`;
      const imageSrc = new RegExp(`(\\bsrc\\s*=\\s*["'])[^"']*${asset.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(["'])`, 'i');
      if (imageSrc.test(stemHtml)) stemHtml = stemHtml.replace(imageSrc, `$1${relative}$2`);
      else stemHtml += `<p><img src="${escapeXml(relative)}" alt=""></p>`;
    }

    items.push([
      `    <item ident="${itemIdent}" title="${escapeXml(q.question_id || `Question ${i + 1}`)}">`,
      '      <itemmetadata>',
      '        <qtimetadata>',
      '          <qtimetadatafield>',
      '            <fieldlabel>question_type</fieldlabel>',
      '            <fieldentry>multiple_choice_question</fieldentry>',
      '          </qtimetadatafield>',
      '          <qtimetadatafield>',
      '            <fieldlabel>points_possible</fieldlabel>',
      `            <fieldentry>${Number.isFinite(Number(q.points)) ? Number(q.points) : 1}</fieldentry>`,
      '          </qtimetadatafield>',
      '        </qtimetadata>',
      '      </itemmetadata>',
      '      <presentation>',
      '        <material>',
      `          <mattext texttype="text/html">${escapeXml(stemHtml)}</mattext>`,
      '        </material>',
      `        <response_lid ident="${respIdent}" rcardinality="Single">`,
      `          <render_choice shuffle="${q.shuffle === true ? 'Yes' : 'No'}">`,
      labels,
      '          </render_choice>',
      '        </response_lid>',
      '      </presentation>',
      '      <resprocessing>',
      '        <outcomes>',
      '          <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>',
      '        </outcomes>',
      '        <respcondition continue="No">',
      '          <conditionvar>',
      `            <varequal respident="${respIdent}">${itemIdent}_a${q.correct_index}</varequal>`,
      '          </conditionvar>',
      '          <setvar action="Set" varname="SCORE">100</setvar>',
      '        </respcondition>',
      '      </resprocessing>',
      feedback,
      '    </item>',
    ].filter(Boolean).join('\n'));
  });

  const assessmentXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">',
    `  <assessment ident="${assessmentIdent}" title="${escapeXml(title)}">`,
    '    <section ident="root_section">',
    items.join('\n'),
    '    </section>',
    '  </assessment>',
    '</questestinterop>',
  ].join('\n');

  const assessmentPath = `${assessmentIdent}/${assessmentIdent}.xml`;
  const manifestMediaFiles = Array.from(usedMedia.values())
    .map((asset) => `      <file href="${assessmentIdent}/media/${escapeXml(exportName(asset))}"/>`);
  const manifestXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<manifest identifier="${assessmentIdent}_manifest" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">`,
    '  <metadata>',
    '    <schema>IMS Content</schema>',
    '    <schemaversion>1.1.3</schemaversion>',
    '  </metadata>',
    '  <organizations/>',
    '  <resources>',
    `    <resource identifier="${assessmentIdent}" type="imsqti_xmlv1p2" href="${assessmentPath}">`,
    `      <file href="${assessmentPath}"/>`,
    ...manifestMediaFiles,
    '    </resource>',
    '  </resources>',
    '</manifest>',
  ].join('\n');

  const zip = new AdmZip();
  zip.addFile('imsmanifest.xml', Buffer.from(manifestXml, 'utf8'));
  zip.addFile(assessmentPath, Buffer.from(assessmentXml, 'utf8'));
  for (const asset of usedMedia.values()) {
    if (!asset.data_base64) throw new Error(`Missing media bytes for ${asset.media_id}`);
    const data = Buffer.from(asset.data_base64, 'base64');
    if (data.length !== asset.bytes) throw new Error(`Media byte count mismatch for ${asset.media_id}`);
    zip.addFile(`${assessmentIdent}/media/${exportName(asset)}`, data);
  }
  return zip.toBuffer();
}

module.exports = { parseQtiZip, generateQtiZip, parseAssessmentXml };
