'use strict';

const fs = require('fs');
const path = require('path');
const { parseMoodleXml, generateMoodleXml, parseQtiZip, generateQtiZip } = require('../src/converters');
const { makeMediaAsset } = require('../src/converters/media');
const { assertFidelityReport } = require('../src/converters/canonical');

const outputDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'proof'));
fs.mkdirSync(outputDir, { recursive: true });

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const asset = makeMediaAsset(png, 'proof-pixel.png', 'image/png', 'proof-pixel.png');
const pack = {
  pack_id: 'p4p5_real_proof',
  title: 'P4P5 Real Moodle Proof',
  media: [asset],
  questions: [{
    question_id: 'p4p5_image',
    title: 'P4P5 Image Preservation',
    text: 'Which image is attached?',
    text_html: '<p>Which image is attached?</p><p><img src="proof-pixel.png" alt="proof"></p>',
    options: ['One pixel', 'No image'],
    correct_index: 0,
    points: 1,
    shuffle: false,
    image_ids: [asset.media_id],
  }],
};

const moodlePath = path.join(outputDir, 'p4p5-input.moodle.xml');
const qtiPath = path.join(outputDir, 'p4p5-input.qti.zip');
fs.writeFileSync(moodlePath, generateMoodleXml(pack));
fs.writeFileSync(qtiPath, generateQtiZip(pack));

const moodle = parseMoodleXml(fs.readFileSync(moodlePath, 'utf8'));
const qti = parseQtiZip(fs.readFileSync(qtiPath));
assertFidelityReport(moodle.fidelity);
assertFidelityReport(qti.fidelity);
if (moodle.media[0].sha256 !== asset.sha256 || qti.media[0].sha256 !== asset.sha256) {
  throw new Error('Generated proof fixtures did not preserve image bytes');
}

console.log(JSON.stringify({
  ok: true,
  image_sha256: asset.sha256,
  moodle: { path: moodlePath, questions: moodle.questions.length, media: moodle.media.length, fidelity: moodle.fidelity },
  canvas_qti: { path: qtiPath, questions: qti.questions.length, media: qti.media.length, fidelity: qti.fidelity },
}, null, 2));
