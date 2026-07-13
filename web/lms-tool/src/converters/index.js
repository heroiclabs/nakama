'use strict';

const { parseMoodleXml, generateMoodleXml } = require('./moodle-xml');
const { parseQtiZip, generateQtiZip } = require('./qti');
const { stripHtml, createFidelityReport } = require('./canonical');

module.exports = {
  parseMoodleXml,
  generateMoodleXml,
  parseQtiZip,
  generateQtiZip,
  stripHtml,
  createFidelityReport,
};
