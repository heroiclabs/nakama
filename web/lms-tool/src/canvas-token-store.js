'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createCanvasTokenStore(filePath, secret) {
  if (!secret || secret.length < 32) throw new Error('CANVAS_TOKEN_ENCRYPTION_KEY must be at least 32 characters');
  const key = crypto.createHash('sha256').update(secret).digest();

  function load() {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return { version: 1, records: {} }; }
  }

  function save(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, filePath);
  }

  function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  function decrypt(envelope) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'));
  }

  function put(teacherId, token) {
    const state = load();
    state.records[teacherId] = encrypt({ ...token, stored_at: new Date().toISOString() });
    save(state);
  }

  function get(teacherId) {
    const envelope = load().records[teacherId];
    return envelope ? decrypt(envelope) : null;
  }

  function remove(teacherId) {
    const state = load();
    delete state.records[teacherId];
    save(state);
  }

  return { put, get, remove };
}

module.exports = { createCanvasTokenStore };
