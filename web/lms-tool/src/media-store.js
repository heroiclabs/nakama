'use strict';

const fs = require('fs');
const path = require('path');
const { makeMediaAsset, assertTotalMediaSize } = require('./converters/media');

function createMediaStore(rootDir) {
  const root = path.resolve(rootDir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  function persist(assets) {
    assertTotalMediaSize(assets);
    return (assets || []).map((input) => {
      const verified = makeMediaAsset(
        Buffer.from(String(input.data_base64 || ''), 'base64'),
        input.filename,
        input.mime_type,
        input.source_path
      );
      if (input.sha256 && input.sha256 !== verified.sha256) throw new Error(`Media checksum mismatch: ${input.filename}`);
      const filename = `${verified.media_id}${path.extname(verified.filename)}`;
      const target = path.join(root, filename);
      if (!target.startsWith(root + path.sep)) throw new Error('Unsafe media storage path');
      fs.writeFileSync(target, Buffer.from(verified.data_base64, 'base64'), { mode: 0o600, flag: 'w' });
      return {
        ...verified,
        storage_key: filename,
        url: `/media/${verified.media_id}`,
      };
    });
  }

  function find(mediaId) {
    if (!/^media_[a-f0-9]{20}$/.test(String(mediaId || ''))) return null;
    const file = fs.readdirSync(root).find((name) => name.startsWith(`${mediaId}.`));
    if (!file) return null;
    const target = path.join(root, file);
    if (!target.startsWith(root + path.sep)) return null;
    return target;
  }

  function hydrate(asset) {
    if (asset.data_base64) return asset;
    const target = find(asset.media_id);
    if (!target) throw new Error(`Stored media not found: ${asset.media_id}`);
    return { ...asset, data_base64: fs.readFileSync(target).toString('base64') };
  }

  function serve(req, res) {
    const target = find(req.params.mediaId);
    if (!target) return res.status(404).send('Media not found');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(target);
  }

  return { root, persist, find, hydrate, serve };
}

module.exports = { createMediaStore };
