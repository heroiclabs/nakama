'use strict';

const multer = require('multer');
const crypto = require('crypto');
const { parseMoodleXml, generateMoodleXml } = require('../converters/moodle-xml');
const { parseQtiZip, generateQtiZip } = require('../converters/qti');
const { assertFidelityReport, buildProvenance } = require('../converters/canonical');
const { renderConverter } = require('../pages/converter');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 4 },
});

function setupConverterRoutes(app) {
  app.get('/converter', (req, res) => res.send(renderConverter()));
  app.post('/api/converter/convert', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    try {
      const filename = req.file.originalname || 'upload';
      const sourceHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      let parsed;
      let sourcePlatform;
      if (/\.zip$/i.test(filename)) {
        sourcePlatform = 'canvas';
        parsed = parseQtiZip(req.file.buffer, { source: { filename, source_sha256: sourceHash } });
      } else if (/\.xml$/i.test(filename)) {
        sourcePlatform = 'moodle';
        parsed = parseMoodleXml(req.file.buffer.toString('utf8'), { source: { filename, source_sha256: sourceHash } });
      } else {
        return res.status(400).json({ error: 'unsupported_type', message: 'Use a Canvas QTI .zip or Moodle .xml file' });
      }
      assertFidelityReport(parsed.fidelity);
      if (!parsed.questions.length) return res.status(422).json({ error: 'nothing_importable', fidelity: parsed.fidelity });
      const pack = {
        pack_id: `converted_${sourceHash.slice(0, 12)}`,
        title: parsed.title,
        questions: parsed.questions,
        media: parsed.media || [],
        source: buildProvenance(sourcePlatform, parsed.fidelity.source_format, { filename, source_sha256: sourceHash }),
        fidelity: parsed.fidelity,
      };
      const to = String(req.body.to || '');
      let output;
      let outputName;
      let mimeType;
      if (to === 'moodle') {
        output = Buffer.from(generateMoodleXml(pack), 'utf8');
        outputName = `${pack.pack_id}.moodle.xml`;
        mimeType = 'application/xml';
      } else if (to === 'canvas') {
        output = generateQtiZip(pack);
        outputName = `${pack.pack_id}.qti.zip`;
        mimeType = 'application/zip';
      } else {
        return res.status(400).json({ error: 'invalid_target', message: 'Target must be canvas or moodle' });
      }
      return res.json({
        filename: outputName,
        mime_type: mimeType,
        output_base64: output.toString('base64'),
        provenance: pack.source,
        fidelity: parsed.fidelity,
      });
    } catch (err) {
      return res.status(400).json({ error: 'convert_failed', message: err.message });
    }
  });
  return [
    { route: '/converter', method: 'GET' },
    { route: '/api/converter/convert', method: 'POST' },
  ];
}

module.exports = { setupConverterRoutes };
