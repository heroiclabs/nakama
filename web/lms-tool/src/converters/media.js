'use strict';

const crypto = require('crypto');
const path = require('path');

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 20 * 1024 * 1024;
const ALLOWED_MEDIA = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
});

function safeArchivePath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    throw new Error(`Unsafe package path: ${raw || '(empty)'}`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Unsafe package path: ${raw}`);
  }
  return normalized.replace(/^\.\//, '');
}

function resolvePackagePath(baseFile, reference) {
  const cleanRef = String(reference || '').split(/[?#]/, 1)[0];
  if (/^(data:|https?:|blob:)/i.test(cleanRef)) return null;
  return safeArchivePath(path.posix.join(path.posix.dirname(safeArchivePath(baseFile)), cleanRef));
}

function safeFilename(value, fallback) {
  const name = path.posix.basename(String(value || '').replace(/\\/g, '/'));
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned || fallback || 'media.bin';
}

function sniffMime(buffer, declaredMime, filename) {
  const b = Buffer.from(buffer);
  let detected = '';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) detected = 'image/png';
  else if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) detected = 'image/jpeg';
  else if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'))) detected = 'image/gif';
  else if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') detected = 'image/webp';
  else {
    const start = b.subarray(0, 512).toString('utf8').trimStart();
    if (/^<\?xml[\s\S]*?<svg\b|^<svg\b/i.test(start)) detected = 'image/svg+xml';
  }
  const declared = String(declaredMime || '').toLowerCase().split(';')[0];
  const selected = detected || '';
  if (!ALLOWED_MEDIA[selected]) throw new Error(`Unsupported or unrecognized media type for ${filename || 'attachment'}`);
  if (detected && declared && ALLOWED_MEDIA[declared] && detected !== declared) {
    throw new Error(`Media type mismatch for ${filename || 'attachment'}: declared ${declared}, detected ${detected}`);
  }
  return selected;
}

function makeMediaAsset(buffer, filename, declaredMime, sourcePath) {
  const data = Buffer.from(buffer);
  if (!data.length) throw new Error(`Empty media attachment: ${filename || sourcePath || 'unknown'}`);
  if (data.length > MAX_MEDIA_BYTES) throw new Error(`Media attachment exceeds ${MAX_MEDIA_BYTES} bytes: ${filename || sourcePath}`);
  const mimeType = sniffMime(data, declaredMime, filename);
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  return {
    media_id: `media_${sha256.slice(0, 20)}`,
    filename: safeFilename(filename, `image${ALLOWED_MEDIA[mimeType]}`),
    mime_type: mimeType,
    bytes: data.length,
    sha256,
    source_path: sourcePath || null,
    data_base64: data.toString('base64'),
  };
}

function assertTotalMediaSize(media) {
  const total = (media || []).reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  if (total > MAX_TOTAL_MEDIA_BYTES) throw new Error(`Package media exceeds ${MAX_TOTAL_MEDIA_BYTES} bytes`);
  return total;
}

function imageRefsFromHtml(html) {
  const refs = [];
  String(html || '').replace(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi, (match, quote, src) => {
    refs.push(src);
    return match;
  });
  return refs;
}

module.exports = {
  ALLOWED_MEDIA,
  MAX_MEDIA_BYTES,
  MAX_TOTAL_MEDIA_BYTES,
  safeArchivePath,
  resolvePackagePath,
  safeFilename,
  makeMediaAsset,
  assertTotalMediaSize,
  imageRefsFromHtml,
};
